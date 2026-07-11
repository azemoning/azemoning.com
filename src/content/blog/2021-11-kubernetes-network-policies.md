---
title: "Your Pods Are Exposed: Locking Down Kubernetes Networking"
slug: kubernetes-network-policies
date: 2021-11-15
category: "Kubernetes"
tags: ["networking", "security", "networkpolicy", "ingress"]
readingTime: "8 min"
excerpt: "Every pod in your cluster can talk to every other pod by default. That's terrifying. Here's how NetworkPolicies fix it."
---

Your pods are exposed. Every pod in the cluster can talk to every other pod. Is that a problem?

Yeah. It is.

I spent a weekend last month helping a friend debug a compromised container in their staging cluster. Someone got into a logging sidecar (don't ask) and from there they could reach the database pods, the Redis cache, even the internal admin API. No firewall rules. No segmentation. Nothing.

This is the default Kubernetes networking model. Flat. Open. Every pod gets a routable IP, and every other pod can reach it. The kube-proxy handles it all transparently. It's elegant for developers who just want things to work. It's a nightmare for anyone who's ever dealt with lateral movement in a breach.

## The flat network problem

When you spin up a Kubernetes cluster with a CNI like Calico or Cilium, you get pod-to-pod connectivity across all nodes. No configuration needed. That's a feature, not a bug (the original Kubernetes networking design doc is explicit about this). But it means your frontend can talk directly to your database. Your batch job can hit your payment service. Everything can reach everything.

In a small dev cluster, who cares. In production, with dozens of services and sensitive data flowing around, you need segmentation.

## NetworkPolicies are your firewall

Kubernetes gives you `NetworkPolicy` through the `networking.k8s.io/v1` API (stable since 1.7, which feels like ancient history now). A NetworkPolicy is a namespaced resource that controls ingress and egress traffic to pods matched by a label selector.

Here's the thing most people miss: **NetworkPolicies are additive**. Once you create any policy selecting a pod, all traffic not explicitly allowed is denied. But if no policy selects a pod, everything is open. There's no cluster-wide "deny all by default" toggle. You have to opt in per namespace.

Let me show you what I mean. Here's a policy that locks down a database namespace:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: db-ingress
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: postgres
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: api-server
      ports:
        - protocol: TCP
          port: 5432
```

This says: only pods labeled `app: api-server` in the `production` namespace can reach `app: postgres` on port 5432. Everything else gets dropped.

You can also restrict egress. Say you want your API server to only talk to the database and nothing else:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-egress
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: api-server
  policyTypes:
    - Egress
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: postgres
      ports:
        - protocol: TCP
          port: 5432
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
```

Notice I had to explicitly allow DNS. That trips up everyone the first time. If your app can't resolve service names after applying an egress policy, it's because you forgot kube-dns.

## Ingress at the edge

NetworkPolicies handle east-west traffic (pod to pod). For north-south (external to cluster), you use an Ingress resource. As of Kubernetes 1.22, `networking.k8s.io/v1` is the only supported Ingress API. The old `networking.k8s.io/v1beta1` was removed. If you're still on v1beta1 manifests, update them:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  namespace: production
spec:
  ingressClassName: nginx
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api-server
                port:
                  number: 8080
```

The v1 Ingress requires explicit `service.name` and `service.port.number` (no more `serviceName`/`servicePort` shorthand). And notice `ingressClassName` replaces the old annotation.

## What I actually do

In practice, I start with a default deny policy in every namespace:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

Then I open up rules per service as needed. It's tedious. It's the right thing to do. Your CNI needs to support NetworkPolicies (Calico, Cilium, and Weave do; Flannel alone doesn't).

If you're running a cluster today with no NetworkPolicies, I'd bet money there's at least one pod that shouldn't be talking to something it currently can. Go check.