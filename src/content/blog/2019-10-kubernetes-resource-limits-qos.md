---
title: "Your Pod Keeps Getting OOMKilled: Resource Requests, Limits, and QoS Classes"
slug: "kubernetes-resource-limits-qos"
date: 2019-10-22
category: "Kubernetes"
tags: ["kubernetes", "resources", "memory", "qos", "troubleshooting"]
readingTime: "10 min read"
excerpt: "Diagnosing OOMKilled pods, setting sensible resource requests and limits, and understanding the QoS class framework."
---

Your pod keeps getting OOMKilled.

You've checked the logs (nothing useful). You've checked the code (no obvious leaks). You've even SSH'd into the node and watched `top` for a while. Memory usage climbs, then the process vanishes, and `kubectl describe pod` shows that cheerful `OOMKilled` reason under the last termination state.

Before you increase the memory limit and hope for the best, let's walk through what's actually happening and how Kubernetes decides to kill your pod.

<!-- truncate -->

## What OOMKilled actually means

When Kubernetes says OOMKilled, it's the Linux kernel's OOM (Out Of Memory) killer that did the deed, not Kubernetes itself. The kernel watches cgroup memory usage. When a container exceeds its memory limit (not request, limit), the kernel kills the process with SIGKILL. No graceful shutdown, no preStop hook, just dead.

This is different from Kubernetes evicting a pod due to node pressure. Node eviction considers requests; OOMKill considers actual usage against limits.

First step: confirm it's actually a memory problem.

```bash
kubectl describe pod your-pod-name | grep -A 5 "Last State"
```

Look for `Reason: OOMKilled` and note the exit code (usually 137, which is 128 + 9, the SIGKILL signal).

Then check what limits are set:

```bash
kubectl get pod your-pod-name -o jsonpath='{.spec.containers[*].resources}'
```

## Requests vs limits: the difference matters

This is where most confusion starts. People set both to the same value and move on, or they set limits without requests, or they copy-paste from a blog post that was written for a different workload.

**Requests** are what the scheduler uses to decide which node to place your pod on. A pod with `memory: 256Mi` request will be scheduled on a node that has at least 256Mi of allocatable memory available. Requests do not cap usage. Your pod can use more than its request.

**Limits** are the ceiling. If your pod uses more memory than its limit, it gets OOMKilled. If it uses more CPU than its limit, it gets throttled (CPU is compressible, memory is not).

Here's a pod spec with both:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp
spec:
  containers:
    - name: myapp
      image: nginx:1.15
      resources:
        requests:
          memory: "128Mi"
          cpu: "250m"
        limits:
          memory: "256Mi"
          cpu: "500m"
```

The scheduler reserves 128Mi and 250m CPU for this pod. The pod can use up to 256Mi before getting OOMKilled, and up to 500m CPU before getting throttled.

The gap between request and limit is not wasted. It's burst capacity. The pod can use it if the node has it available, but other pods aren't counting on it being there.

## How to figure out what numbers to use

Don't guess. Measure.

If the pod is already running (even if it keeps getting killed), check actual usage:

```bash
kubectl top pod your-pod-name --containers
```

This shows current CPU and memory usage. Run it a few times during peak and off-peak to get a range.

For a more detailed view, check the pod's cgroup stats on the node, or use a monitoring tool. If you have Prometheus, query `container_memory_working_set_bytes` for historical data.

Once you have the numbers:

1. Set the **request** to the typical/average usage. This is what the scheduler uses, so over-requesting wastes cluster capacity.
2. Set the **limit** to 1.5x to 2x the typical usage. This gives headroom for spikes without getting OOMKilled.
3. Watch it for a few days. Adjust.

For CPU, the approach is similar but the consequences are different. Exceeding CPU limits causes throttling, not death. So CPU limits are less dangerous to get wrong, but they can cause latency spikes that are hard to diagnose.

## What happens when you don't set resources

This is the real danger. If you don't set requests and limits, your pod runs with what Kubernetes calls "BestEffort" QoS. And that has consequences when the node gets tight on resources.

## QoS classes: the eviction framework

Kubernetes assigns every pod a Quality of Service class based on its resource configuration. There are three:

**Guaranteed:** Every container in the pod has both requests and limits set, and they're equal. This is the highest priority class. When a node runs out of resources, Guaranteed pods are evicted last.

**Burstable:** At least one container has a request or limit set, but they're not all equal (or some containers don't have any). These are evicted before Guaranteed pods but after BestEffort.

**BestEffort:** No requests or limits set on any container. These are evicted first when the node needs to reclaim resources.

Here's how each looks in practice:

```yaml
# Guaranteed QoS
apiVersion: v1
kind: Pod
metadata:
  name: guaranteed-pod
spec:
  containers:
    - name: app
      image: busybox:1.31
      command: ['sleep', '3600']
      resources:
        requests:
          memory: "256Mi"
          cpu: "500m"
        limits:
          memory: "256Mi"
          cpu: "500m"
---
# Burstable QoS
apiVersion: v1
kind: Pod
metadata:
  name: burstable-pod
spec:
  containers:
    - name: app
      image: busybox:1.31
      command: ['sleep', '3600']
      resources:
        requests:
          memory: "128Mi"
          cpu: "250m"
        limits:
          memory: "256Mi"
          cpu: "500m"
---
# BestEffort QoS
apiVersion: v1
kind: Pod
metadata:
  name: besteffort-pod
spec:
  containers:
    - name: app
      image: busybox:1.31
      command: ['sleep', '3600']
```

Check the QoS class of your pods:

```bash
kubectl get pod your-pod-name -o jsonpath='{.status.qosClass}'
```

## The practical takeaway

For production workloads, aim for Guaranteed QoS. Set requests equal to limits. Yes, you lose burst capacity, but you gain predictability. The scheduler knows exactly what each pod needs. Nodes don't get overcommitted. Eviction order is clear.

If you need burst capacity (and many apps do), use Burstable but be deliberate about it. Know that your pods will be evicted before Guaranteed pods if the node gets tight.

Never leave production pods at BestEffort. It's tempting because it means you don't have to figure out resource numbers. But when the node hits memory pressure, your pods are the first to go. And if you have multiple BestEffort pods, Kubernetes picks the one with the highest actual usage relative to its request (which is zero), so the behavior is essentially unpredictable.

## The OOMKilled checklist

When you see OOMKilled, work through this:

1. `kubectl describe pod` to confirm the reason and exit code
2. `kubectl get pod -o jsonpath` to check current limits
3. `kubectl top pod` to check actual usage (if the pod is running long enough)
4. Set or increase the memory limit to 1.5x to 2x actual usage
5. If it's still getting killed, look for genuine memory leaks (heap dumps, profiling)
6. If the node itself is under memory pressure, check for other pods consuming resources

Number 5 is the one people skip. Sometimes OOMKilled really does mean your app has a memory problem. Increasing the limit just delays the crash and wastes more node memory in the meantime.



Resource management isn't glamorous, but it's the difference between a cluster that runs smoothly and one where pods vanish unpredictably. Set requests. Set limits. Know your QoS class. And when a pod gets OOMKilled, resist the urge to just double the limit and move on.