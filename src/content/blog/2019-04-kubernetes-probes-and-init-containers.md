---
title: "Kubernetes Probes and Init Containers: Knowing When Your Pod Is Actually Ready"
slug: "kubernetes-probes-and-init-containers"
date: 2019-04-15
category: "Kubernetes"
tags: ["kubernetes", "probes", "init-containers", "health-checks", "devops"]
readingTime: "9 min read"
excerpt: "A pod is running. But is it ready? Understanding liveness, readiness, and startup probes, plus how init containers set the stage."
---

A pod is running. But is it ready?

That question sounds philosophical, but it's one you'll face the moment you deploy anything beyond a hello-world app. Kubernetes will happily report a pod as "Running" while your application is still loading config, warming caches, or waiting for a database migration to finish. Traffic hits it. Users get 503s. You get paged at midnight.

The fix involves two things that work together: init containers to prepare the environment, and probes to tell Kubernetes what "ready" actually means.

<!-- truncate -->

## Init containers: do the prep work first

Before you even think about probes, consider whether your main container should be doing its own setup. I've seen pods that run a startup script which downloads config, waits for a dependency, runs migrations, then starts the app. That's fragile. If any step fails, Kubernetes restarts the whole thing and runs all steps again.

Init containers solve this. They run to completion before your main container starts. If an init container fails, Kubernetes retries it (respecting `restartPolicy`). Your main container never starts until all init containers succeed.

Here's a deployment where the init container waits for a database to be reachable:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      initContainers:
        - name: wait-for-db
          image: busybox:1.31
          command:
            - 'sh'
            - '-c'
            - 'until nc -z postgres-service 5432; do echo waiting for db; sleep 2; done'
      containers:
        - name: myapp
          image: nginx:1.15
          ports:
            - containerPort: 80
```

The `wait-for-db` init container runs first. It polls the postgres service until it can connect on port 5432. Only then does the nginx container start. (Replace nginx:1.15 with your actual app image, obviously.)

Init containers have been GA since Kubernetes 1.6, so they're well-established by now. No feature gates needed.

## The three probes

Kubernetes gives you three probe types. People often confuse them or use them interchangeably. They serve different purposes.

**Liveness probe:** "Is the process alive?" If this fails, Kubernetes kills the container and restarts it. Use this for situations where your app is stuck (deadlock, infinite loop) and a restart is the only fix.

**Readiness probe:** "Can this pod accept traffic?" If this fails, Kubernetes removes the pod from the Service endpoints. The pod keeps running, it just stops receiving requests. Use this for temporary states like loading data or reconnecting to a dependency.

**Startup probe:** This one was introduced as alpha in 1.16 (so not yet in 1.14). For now, if your app has a long startup time, you'll need to set generous `initialDelaySeconds` on the liveness probe to avoid killing it before it finishes starting.

Here's the decision framework I use:

| Situation | Probe to use |
|-----------|-------------|
| App loads data on start, temporarily not ready | Readiness |
| App can deadlock or get stuck | Liveness |
| Both: slow startup AND can get stuck | Liveness with long initialDelaySeconds |

## Putting probes into practice

Let's look at a more complete example with both liveness and readiness probes:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      initContainers:
        - name: wait-for-db
          image: busybox:1.31
          command:
            - 'sh'
            - '-c'
            - 'until nc -z postgres-service 5432; do echo waiting for db; sleep 2; done'
      containers:
        - name: myapp
          image: nginx:1.15
          ports:
            - containerPort: 80
          livenessProbe:
            httpGet:
              path: /healthz
              port: 80
            initialDelaySeconds: 15
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /ready
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 5
```

A few things worth noting here.

The liveness probe has `initialDelaySeconds: 15`. That's 15 seconds before the first check. If your app takes 30 seconds to start, bump this up. A liveness probe that fires before the app is ready will trigger a restart, which delays startup, which triggers another restart. You'll see your pod stuck in a CrashLoopBackOff and wonder what happened. This is almost always the cause.

The readiness probe has a shorter delay and more frequent checks. That makes sense: you want to know quickly when a pod goes unready, and you want to know quickly when it comes back.

Both probes hit HTTP endpoints (`/healthz` and `/ready`). You could also use a TCP check (`tcpSocket` on a port) or a command probe (run a shell command). HTTP is usually the right choice for web services.

## The /healthz vs /ready distinction

This trips people up. Your `/healthz` endpoint should check internal state: can the process handle requests? Is the event loop responsive? Your `/ready` endpoint should check external dependencies: is the database reachable? Is the cache warmed up? Are background workers running?

Don't put dependency checks in `/healthz`. If your database goes down and your liveness probe fails, Kubernetes will restart your pod. Restarting it won't fix the database. Now you're restarting pods for no reason while the actual problem persists.

## A common pattern with init containers and probes

Here's a pattern I've used at scale. The init container handles infrastructure dependencies (waiting for services). The readiness probe handles application-level readiness (waiting for data to load). The liveness probe handles stuck processes.

```
initContainer: wait for postgres
    ↓ (runs to completion)
container starts
    ↓
readiness probe: /ready returns 200 only after config is loaded
    ↓
pod receives traffic
    ↓ (ongoing)
liveness probe: /healthz checks if process is responsive
    ↓ (if fails)
container restart
```

Each layer handles a different failure mode. Init containers for prerequisites. Readiness for temporary unavailability. Liveness for permanent failures.



Probes are one of those Kubernetes features that feel optional until they're not. A pod without probes will run fine in development and fall over in production under real load and real failure modes. Start with at least a readiness probe on every container. Add liveness probes once you understand your app's failure characteristics. And use init containers to keep your main container's startup logic clean.

The API objects here are all stable (`apps/v1` for Deployment, `v1` for Pod and Service). No alpha flags, no feature gates. This is standard Kubernetes, and it's been this way for a while. Use it.