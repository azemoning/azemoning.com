---
title: "From 10 to 10,000 Requests: HPA v2 and the Art of Actually Scaling"
slug: hpa-custom-metrics-autoscaling-v2
date: 2022-10-04
category: "Kubernetes"
tags: ["autoscaling", "hpa", "metrics", "performance"]
readingTime: "10 min"
excerpt: "Your app handles 10 requests per second. Traffic doubles. What happens? If you're only using CPU metrics, the answer is probably wrong."
---

Your app handles 10 requests per second. Traffic doubles. What happens?

If you're running a Horizontal Pod Autoscaler based on CPU utilization, the answer depends entirely on whether your app is CPU-bound. Most web apps aren't. They're waiting on database queries, external API calls, message queues. CPU sits at 15% while request latency climbs to 3 seconds and your users start complaining.

I've seen this exact scenario three times this year. Each time, the team had HPA configured. Each time, it wasn't scaling because CPU was fine. The pods were drowning in I/O wait, and the autoscaler was blissfully unaware.

## HPA v1 was too simple

The original HPA (`autoscaling/v1`) scaled on CPU utilization alone. You'd set a target percentage, and Kubernetes would add or remove pods to keep average CPU around that target.

```yaml
apiVersion: autoscaling/v1
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-server
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 60
```

That's fine for compute-heavy workloads. For everything else, it's insufficient.

## autoscaling/v2 gives you real options

The `autoscaling/v2` API (GA since 1.23) is the current and only supported HPA API. Note: `autoscaling/v2beta1` was removed in 1.25. If you have old manifests, update them now. There's no fallback.

v2 lets you scale on multiple metrics: CPU, memory, custom metrics from Prometheus, external metrics from cloud APIs, even pod metrics like request rate or queue depth.

Here's an HPA that scales on CPU AND a custom metric:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-server
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Pods
      pods:
        metric:
          name: http_requests_per_second
        target:
          type: AverageValue
          averageValue: "100"
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30
      policies:
        - type: Percent
          value: 100
          periodSeconds: 15
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60
```

Let me break down what's new here.

**Multiple metrics.** The HPA evaluates each metric independently and picks the scaling action that results in the most replicas. If CPU says scale to 4 and request rate says scale to 8, you get 8. This is the "max across all metrics" behavior, and it's the right default.

**The `behavior` field.** This is the other big win of v2. In v1, scaling behavior was... aggressive. Pods would appear and disappear like a nervous system reacting to every CPU spike. The `behavior` field lets you tune how fast scaling happens in each direction. Notice I've set a 5-minute stabilization window for scale-down. That means after scaling up, the HPA won't scale down for at least 5 minutes. It prevents the flapping problem where traffic spikes, pods scale up, traffic drops, pods scale down, traffic spikes again.

**The Pods metric type.** This pulls metrics from each pod directly (via the custom.metrics.k8s.io API). You need a metrics adapter running (like the Prometheus Adapter) that exposes your application metrics as Kubernetes-custom metrics.

## Setting up custom metrics

The HPA doesn't generate metrics. It reads them. You need:

1. **A metrics source.** Usually Prometheus scraping your app's `/metrics` endpoint.
2. **A metrics adapter.** The Prometheus Adapter translates Prometheus queries into the `custom.metrics.k8s.io` API that the HPA understands.

Here's a Prometheus Adapter configuration that exposes `http_requests_per_second`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-adapter-config
  namespace: monitoring
data:
  config.yaml: |
    rules:
      - seriesQuery: 'http_requests_total{namespace!="",pod!=""}'
        resources:
          overrides:
            namespace: {resource: "namespace"}
            pod: {resource: "pod"}
        name:
          matches: "^(.*)_total$"
          as: "${1}_per_second"
        metricsQuery: 'sum(rate(<<.Series>>{<<.LabelMatchers>>}[2m])) by (<<.GroupBy>>)'
```

This takes the `http_requests_total` counter that your app exposes, computes a per-second rate over 2 minutes, and makes it available as `http_requests_per_second` on the Pods metric type.

## The deployment behind it

For context, here's the Deployment the HPA targets:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-server
  template:
    metadata:
      labels:
        app: api-server
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "8080"
    spec:
      containers:
        - name: api
          image: nginx:1.23
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 256Mi
```

Resource requests matter here. The HPA's CPU-based metric uses `requests` as the baseline for utilization calculations. If you don't set requests, the CPU metric is meaningless. (The Metrics Server can't compute utilization without a baseline.)

## When to use what

CPU-based scaling: good for compute-heavy workloads (image processing, encryption, ML inference).

Memory-based scaling: good for in-memory caches or apps with predictable memory growth.

Custom metrics: good for request rate, queue depth, latency percentiles, anything business-specific.

External metrics: good for cloud provider metrics (SQS queue depth, Pub/Sub backlog, CDN request count).

I generally recommend starting with CPU, adding a custom metric for request rate once you have Prometheus running, and setting conservative scale-down behavior. You can always tighten it later.

## One more thing

The `autoscaling/v2beta1` API is gone in 1.25. If your HPA manifests say `v2beta1` or `v2beta2`, update them to `autoscaling/v2`. The spec format is essentially the same (the beta APIs were forward-compatible). But `kubectl` will reject the old API versions on a 1.25+ cluster, so don't wait until your next upgrade to fix them.