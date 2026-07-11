---
title: "Namespace Is the New Cluster Boundary"
slug: "namespace-resource-governance"
date: 2023-12-05
category: "Kubernetes"
tags: ["kubernetes", "limitrange", "resourcequota", "namespaces", "governance"]
readingTime: "7 min read"
excerpt: "Namespaces aren't just for organizing resources. They're your first line of defense against a single team eating the whole cluster."
---

Namespace is the new cluster boundary.

I don't mean that in a buzzword way. I mean it practically: if you're running multiple teams, multiple environments, or multiple workloads on the same cluster (and you probably are), namespaces combined with LimitRange and ResourceQuota are how you keep one runaway deployment from starving everything else.

I've seen what happens without resource governance. A developer sets a Java heap to 8GB "just to be safe" in a namespace with no limits. The node's memory fills up. The kubelet starts evicting pods. Suddenly the monitoring stack, the ingress controller, and three other teams' services are all gone because one pod wanted more memory than it deserved.

LimitRange and ResourceQuota have been stable (v1) since basically forever. They're not exciting. They're not featured in conference keynotes. They work.

<!-- truncate -->

## LimitRange: per-pod defaults and limits

A LimitRange sets boundaries on individual resources within a namespace. It's the guardrail that catches pods that don't specify their own resource requests and limits.

Here's a practical example. You create a namespace for the backend team:

```bash
kubectl create namespace backend
```

Then you apply a LimitRange that sets default resource constraints:

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: backend-limits
  namespace: backend
spec:
  limits:
    - type: Container
      default:
        cpu: "500m"
        memory: "256Mi"
      defaultRequest:
        cpu: "100m"
        memory: "128Mi"
      max:
        cpu: "2"
        memory: "2Gi"
      min:
        cpu: "50m"
        memory: "64Mi"
    - type: Pod
      max:
        cpu: "4"
        memory: "4Gi"
    - type: PersistentVolumeClaim
      max:
        storage: "10Gi"
      min:
        storage: "1Gi"
```

Let me break down what this actually does.

**Container defaults:** If a developer deploys a pod without specifying `resources.limits` and `resources.requests`, the LimitRange fills them in automatically. The container gets a 500m CPU limit, 256Mi memory limit, 100m CPU request, and 128Mi memory request. This is the "I didn't set resources" safety net.

**Container max/min:** Even if a developer does specify resources, they can't go above 2 CPU or 2Gi memory per container, and can't go below 50m CPU or 64Mi memory. These are hard ceilings and floors.

**Pod max:** The total resource request across all containers in a single pod can't exceed 4 CPU and 4Gi memory. This catches the "twenty sidecar containers" pattern.

**PVC max/min:** PersistentVolumeClaims in this namespace must be between 1Gi and 10Gi. No 500Gi PVCs eating your storage budget.

Here's what happens when someone tries to create a container that violates the limits:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: memory-hog
  namespace: backend
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sleep", "infinity"]
      resources:
        requests:
          memory: "4Gi"
        limits:
          memory: "4Gi"
```

```bash
kubectl apply -f memory-hog.yaml
# Error from server (Forbidden): ...memory max limit set to 2Gi...
```

The API server rejects it. Not at scheduling time, not at runtime. At admission. The pod never exists.

## ResourceQuota: namespace-level caps

LimitRange controls individual pods. ResourceQuota controls the *total* consumption of a namespace. They're complementary, not redundant.

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: backend-quota
  namespace: backend
spec:
  hard:
    requests.cpu: "8"
    requests.memory: "16Gi"
    limits.cpu: "16"
    limits.memory: "32Gi"
    pods: "50"
    services: "10"
    persistentvolumeclaims: "20"
    requests.storage: "100Gi"
    configmaps: "30"
    secrets: "30"
```

This quota says the backend namespace can use at most 8 CPU requests, 16Gi memory requests, 50 pods, 10 services, and 100Gi of storage across everything running in it.

Check current usage:

```bash
kubectl describe resourcequota backend-quota -n backend
```

```
Name:                   backend-quota
Namespace:              backend
Resource                Used   Hard
--------                ----   ----
configmaps              5      30
limits.cpu              2      16
limits.memory           4Gi    32Gi
persistentvolumeclaims  3      20
pods                    12     50
requests.cpu            1      8
requests.memory         2Gi    16Gi
requests.storage        15Gi   100Gi
services                2      10
```

When the Used column approaches the Hard column, new pods in this namespace will be rejected until existing ones are removed or the quota is increased.

## How LimitRange and ResourceQuota interact

This is where people get confused. They set a LimitRange with defaults and a ResourceQuota, then wonder why pods are being rejected. The answer is usually that the LimitRange defaults push the namespace over the quota.

Scenario: Your LimitRange defaults a container to 500m CPU. Your ResourceQuota allows 4 CPU total. A developer deploys 10 replicas. Each replica has one container, so each gets the 500m default. 10 × 500m = 5 CPU. The quota is 4 CPU. The first 8 pods start fine. The last 2 are rejected.

This is actually the correct behavior. The system is doing its job. But it's confusing if you didn't plan for the math.

The practical approach: set your LimitRange defaults to something reasonable for a typical pod in that namespace, then size your ResourceQuota based on how many of those pods you expect.

```yaml
# LimitRange default: 200m CPU, 256Mi memory per container
# ResourceQuota: 4 CPU, 8Gi memory
# Expected capacity: ~20 single-container pods
```

## Counting quotas

Beyond compute resources, ResourceQuota can limit the number of API objects in a namespace. This is less obvious but equally useful.

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: object-counts
  namespace: backend
spec:
  hard:
    count/deployments.apps: "10"
    count/jobs.batch: "5"
    count/cronjobs.batch: "3"
    count/ingresses.networking.k8s.io: "5"
```

I use this to prevent namespace sprawl at the object level. There's no reason a single team namespace should have 200 Deployments. If they do, something has gone wrong (usually a broken CI pipeline creating Deployments instead of updating them).

## Scoped quotas

You can create quotas that only apply to certain classes of pods. For example, you might want to allow best-effort pods (no resource requests) but cap their count separately from guaranteed pods.

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: best-effort-quota
  namespace: backend
spec:
  hard:
    pods: "10"
  scopes:
    - BestEffort
```

This quota only counts pods in the BestEffort QoS class (pods with no resource requests or limits). Your guaranteed and burstable pods have their own quota.

## Practical setup script

When I set up a new namespace for a team, I apply both resources together:

```bash
#!/bin/bash
NAMESPACE=$1

kubectl create namespace "$NAMESPACE"

cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: $NAMESPACE
spec:
  limits:
    - type: Container
      default:
        cpu: "500m"
        memory: "256Mi"
      defaultRequest:
        cpu: "100m"
        memory: "128Mi"
      max:
        cpu: "2"
        memory: "2Gi"
EOF

cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ResourceQuota
metadata:
  name: namespace-quota
  namespace: $NAMESPACE
spec:
  hard:
    requests.cpu: "8"
    requests.memory: "16Gi"
    limits.cpu: "16"
    limits.memory: "32Gi"
    pods: "50"
    services: "10"
    persistentvolumeclaims: "20"
    requests.storage: "100Gi"
EOF
```

Teams can request quota increases through whatever process you have. The defaults are generous enough for normal development but tight enough to prevent runaway consumption.



Resource governance isn't glamorous work. Nobody's going to put "configured LimitRange defaults" on their performance review. But it's the kind of infrastructure that prevents 5 AM pages and inter-team arguments about who ate all the cluster resources.

Start with a LimitRange per namespace. Add a ResourceQuota. Adjust based on actual usage patterns. The numbers don't need to be perfect on day one. They just need to exist, so that when something goes wrong, it fails in a bounded way instead of taking down the whole cluster.