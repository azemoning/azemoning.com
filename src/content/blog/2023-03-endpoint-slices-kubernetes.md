---
title: "Endpoints Are Dead. Long Live EndpointSlices."
slug: endpoint-slices-kubernetes
date: 2023-03-14
category: "Kubernetes"
tags: ["networking", "services", "endpointslices", "scalability"]
readingTime: "8 min"
excerpt: "kubectl get endpoints shows you one thing. EndpointSlices show you another. Here's why the old model broke and what replaced it."
---

`kubectl get endpoints` shows you one thing. `kubectl get endpointslices` shows you another.

They both describe where a Service's traffic should go. But Endpoints (the old way) puts every backend pod IP into a single object. EndpointSlices (the new way) breaks that list into chunks. The difference sounds trivial. It's not.

I ran into this last year helping a team scale their API service to 800 pods behind one Service. Every time a pod restarted, the Endpoints object updated. That object was 45KB. Every update got broadcast to every node in the cluster. Every kube-proxy on every node processed the full 45KB. We had 120 nodes. That's 5.4MB of Endpoints traffic per pod restart, and during a rolling update of 800 pods, kube-proxy was drowning. API server CPU spiked. Network latency climbed.

The fix was switching to EndpointSlices.

## The Endpoints problem

An `Endpoints` object (the `v1` core API) stores all pod IPs for a Service in one resource. For a Service with 10 pods, that's 10 entries in one object. For 1000 pods, that's 1000 entries. Every change to that list (a pod starting, a pod dying, a readiness probe failing) updates the entire object. The update propagates through the API server to every watcher.

kube-proxy is a watcher. So is CoreDNS. So is every ingress controller and service mesh sidecar. They all get the full Endpoints object every time it changes.

This is O(n*m) complexity: n endpoints times m watchers. At scale, it kills performance. The Kubernetes networking SIG documented cases where Endpoints objects for large Services caused API server memory spikes, increased etcd write latency, and kube-proxy update lag measured in seconds (not milliseconds).

## EndpointSlices fix the math

`EndpointSlice` (`discovery.k8s.io/v1`, with `v1beta1` removed in 1.25) divides the backend list into slices of 100 endpoints by default. A Service with 800 pods gets 8 EndpointSlice objects instead of one Endpoints object.

When a pod changes, only the slice containing that pod's IP gets updated. Watchers receive a smaller delta. The API server processes fewer bytes per event. kube-proxy applies partial updates instead of full replacements.

Here's what an EndpointSlice looks like:

```yaml
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: api-server-abc12
  namespace: production
  labels:
    kubernetes.io/service-name: api-server
addressType: IPv4
endpoints:
  - addresses:
      - 10.244.1.15
    conditions:
      ready: true
    nodeName: node-1
  - addresses:
      - 10.244.2.22
    conditions:
      ready: true
    nodeName: node-2
  - addresses:
      - 10.244.3.8
    conditions:
      ready: false
    nodeName: node-3
ports:
  - port: 8080
    protocol: TCP
```

A few things to notice:

**`conditions.ready`** replaces the implicit "present in the list = ready" model of Endpoints. An endpoint can be explicitly not-ready while still being listed (useful for traffic draining during termination).

**`nodeName`** is populated. The old Endpoints object didn't track which node an endpoint was on. EndpointSlices do, which enables topology-aware routing (traffic prefers endpoints in the same zone).

**`addressType`** can be `IPv4`, `IPv6`, or `FQDN`. The old Endpoints object mixed address types awkwardly. EndpointSlices make dual-stack services cleaner.

## The Service and Deployment

For completeness, here's the Service and Deployment that generate these slices:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
  namespace: production
spec:
  replicas: 50
  selector:
    matchLabels:
      app: api-server
  template:
    metadata:
      labels:
        app: api-server
    spec:
      containers:
        - name: api
          image: nginx:1.23
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /healthz
              port: 8080
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: api-server
  namespace: production
spec:
  selector:
    app: api-server
  ports:
    - port: 80
      targetPort: 8080
  type: ClusterIP
```

When you create this Service, the EndpointSlice controller (built into the kube-controller-manager) automatically creates and manages EndpointSlice objects. You don't create them manually. The controller watches the Service's selector, finds matching pods, and distributes their IPs across slices.

## Checking your slices

```bash
kubectl get endpointslices -n production
```

You'll see something like:

```
NAME               ADDRESSTYPE   PORTS   ENDPOINTS   AGE
api-server-abc12   IPv4          80      100/50      2d
api-server-def34   IPv4          80      100/50      2d
api-server-ghi56   IPv4          80      50/50       2d
```

The fractions show ready vs total endpoints in each slice.

To see the old Endpoints object (which still exists for backward compatibility):

```bash
kubectl get endpoints api-server -n production
```

This still works. The Endpoints controller maintains a legacy Endpoints object that mirrors the EndpointSlice data (but truncated to 1000 endpoints in 1.25+). So existing tooling doesn't break. But new integrations should use EndpointSlices.

## Why this matters now

EndpointSlices have been the default since 1.21. But a lot of people are still mentally model Services with the old Endpoints picture. If you're debugging service routing, checking `kubectl get endpoints` might not show you the full story (especially above 1000 backends, where the legacy Endpoints object truncates).

More importantly, if you're building anything that watches service backends (custom controllers, service mesh control planes, monitoring tools), you should be watching EndpointSlices, not Endpoints. The old API is maintained for compatibility, not for performance.

The migration happened quietly. Most people never noticed because the kube-proxy and CoreDNS switched automatically. But now that `discovery.k8s.io/v1beta1` is gone (removed in 1.25), any tooling still referencing the beta API breaks. Update your imports. Use `discovery.k8s.io/v1`. It's the only EndpointSlice API going forward.