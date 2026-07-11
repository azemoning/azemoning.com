---
title: "OpenShift Routes vs Kubernetes Ingress: An Honest Comparison"
slug: "openshift-routes-vs-ingress"
date: 2022-11-20
category: "OpenShift"
tags: ["openshift", "routes", "ingress", "networking", "haproxy"]
readingTime: "9 min read"
excerpt: "OpenShift has Routes. Kubernetes has Ingress. Which one should you use? The answer depends on your cluster."
---

OpenShift has Routes. Kubernetes has Ingress. Which one should you use?

I get this question from developers at least once a month. They've read about Ingress in the Kubernetes docs, they've seen tutorials using nginx-ingress-controller, and then they land on our OpenShift cluster and find... something different. Something called a Route. And they want to know: should I use Routes or Ingress? Is one better?

The honest answer is: it depends. Let me walk through both.

<!-- truncate -->

## What is a Route?

A Route is an OpenShift-native resource. It's been around since OpenShift 3.x, long before Kubernetes had Ingress as a standard. The API lives under `route.openshift.io/v1`:

```yaml
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: my-app
  namespace: my-project
spec:
  host: my-app.apps.cluster.example.com
  to:
    kind: Service
    name: my-app-svc
    weight: 100
  port:
    targetPort: 8080
  tls:
    termination: edge
    insecureEdgeTerminationPolicy: Redirect
```

That's a basic Route. It takes incoming HTTPS traffic on `my-app.apps.cluster.example.com` and forwards it to the `my-app-svc` Service on port 8080. The `tls` section handles HTTPS termination.

The `spec.to` field points to a Service. The `spec.host` is the external hostname. The `spec.tls` section configures how TLS works.

## What is an Ingress?

Ingress is the Kubernetes-native way to expose HTTP(S) services. It's been around since 1.2 (as a beta) and graduated to GA in Kubernetes 1.19. Under OCP 4.10, which runs Kubernetes 1.24, `networking.k8s.io/v1` Ingress is fully supported:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app
  namespace: my-project
spec:
  tls:
  - hosts:
    - my-app.apps.cluster.example.com
    secretName: my-tls-secret
  rules:
  - host: my-app.apps.cluster.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: my-app-svc
            port:
              number: 8080
```

More verbose, but it's the upstream standard. Every Kubernetes distribution supports it.

## The key differences

Here's a practical comparison:

| Feature | Route | Ingress (on OpenShift) |
|---------|-------|----------------------|
| API Group | `route.openshift.io/v1` | `networking.k8s.io/v1` |
| Controller | HAProxy router pod (built-in) | Also uses HAProxy router (on OCP) |
| TLS management | Inline in the Route spec | References a Secret |
| Path-based routing | No (one Route per host+path) | Yes (multiple paths per host) |
| Weighted routing | Yes (A/B, canary) | No (standard Ingress doesn't support this) |
| Console integration | Full support | Partial |
| Port specification | `spec.port.targetPort` | `backend.service.port.number` |

The weighted routing thing is a big deal for us. We do canary deployments where we send 10% of traffic to a new version. With a Route, that's built in:

```yaml
# Canary Route - send 10% to v2
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: my-app-canary
  namespace: my-project
spec:
  host: my-app.apps.cluster.example.com
  to:
    kind: Service
    name: my-app-v2-svc
    weight: 10
  alternateBackends:
  - kind: Service
    name: my-app-v1-svc
    weight: 90
```

You can't do this with a standard Kubernetes Ingress. You'd need a service mesh or a custom ingress controller that supports weighted backends.

## How TLS works differently

This is where the two diverge the most.

**Routes** handle TLS inline. You put the certificate and key directly in the Route spec, or (more commonly) you let OpenShift generate them automatically. With edge termination, the HAProxy router handles the TLS handshake and forwards plain HTTP to the pod:

```yaml
spec:
  tls:
    termination: edge
    certificate: |
      -----BEGIN CERTIFICATE-----
      ...
      -----END CERTIFICATE-----
    key: |
      [REDACTED PRIVATE KEY]
```

Most of the time, you don't even specify certificates. OpenShift's default wildcard cert covers `*.apps.cluster.example.com`. For custom domains, you provide the cert, or use cert-manager with an Ingress.

**Ingress** requires you to create a Kubernetes Secret with the TLS cert and key, then reference it:

```yaml
spec:
  tls:
  - hosts:
    - my-app.example.com
    secretName: my-tls-secret
```

More steps, but it's the standard Kubernetes way. And it works across clusters.

## The HAProxy router: what's actually running

Whether you create a Route or an Ingress on OpenShift, the traffic goes through the same HAProxy router pod. It lives in the `openshift-ingress` namespace:

```bash
oc get pods -n openshift-ingress
# NAME                              READY   STATUS    RESTARTS   AGE
# router-default-6f8b947d8f-abc12   1/1     Running   0          5d

oc get pods -n openshift-ingress-canary
# Canary pods that monitor router health
```

The router watches both Route and Ingress resources. When you create either one, the router reconfigures HAProxy to handle the new route. From a traffic perspective, they're equivalent.

One thing to know: the HAProxy router pod is managed by the cluster. You don't configure it directly. If you need to tune HAProxy settings (timeouts, max connections), you edit the `IngressController` resource:

```yaml
apiVersion: operator.openshift.io/v1
kind: IngressController
metadata:
  name: default
  namespace: openshift-ingress-operator
spec:
  replicas: 2
  tuningOptions:
    clientTimeout: 30s
    serverTimeout: 30s
```

## When to use Route

Use a Route when:

- You're on OpenShift and want the simplest path to exposing a service
- You need weighted routing (canary deployments)
- You want the web console to show your routes with links
- You're using OpenShift's default wildcard certificate
- Your team is already used to OpenShift conventions

## When to use Ingress

Use Ingress when:

- You need path-based routing (multiple paths under one host)
- You're writing manifests that need to work across Kubernetes distributions
- You're following tutorials or docs written for vanilla Kubernetes
- You want to use cert-manager with `ingress-shim` annotations
- Your organization might move off OpenShift someday (portability)

## What I recommend

For most internal applications, we use Routes. They're simpler, the developers are used to them, and the canary deployment feature is useful for our release process.

For applications that might move to a different platform, we use Ingress. We have a few services that run on both our OpenShift cluster and a managed Kubernetes service. Those use Ingress so the manifests stay portable.

The honest truth: for most teams on OpenShift, it doesn't matter that much. Pick one, be consistent, and move on. The networking stack underneath is the same HAProxy router either way. The difference is in the YAML you write, not in the traffic that flows.