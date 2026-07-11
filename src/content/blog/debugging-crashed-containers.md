---
title: "Debugging Crashed Containers with kubectl debug"
slug: "debugging-crashed-containers"
date: 2023-05-15
category: "Kubernetes"
tags: ["kubernetes", "debugging", "kubectl", "ephemeral-containers"]
readingTime: "8 min read"
excerpt: "You can't exec into a crashed container. It's crashed. Here's how kubectl debug gets you out of that hole."
---

You can't exec into a crashed container. It's crashed. Now what?

This is the moment that separates "I read the docs" from "I've been paged at 1 AM." Your pod is in CrashLoopBackOff. The process inside keeps dying. `kubectl exec` won't work because there's nothing to exec into. The logs might show something, but sometimes they don't. You need to get *inside* the environment where the process was running and poke around.

Before Kubernetes 1.25 shipped ephemeral containers as GA, this was a genuinely painful problem. People worked around it by building debug images, SSH-ing into nodes, or (my personal favorite) adding `sleep infinity` to their deployment spec and praying they'd remember to remove it.

<!-- truncate -->

## The old way: debug containers via kubectl debug

`kubectl debug` has been available since Kubernetes 1.18 (it was beta for a while). The command lets you attach a temporary container to an existing pod. Think of it as a sidecar that shows up uninvited but is actually useful.

Here's the basic idea. You have a pod called `web-app` that's crashing:

```bash
kubectl debug web-app -it --image=curlimages/curl:7.88.1
```

This creates a new container inside the running pod. You share the process namespace (if configured), you share the network, you share the volumes. You just have a different (working) binary to run.

I reach for `curlimages/curl:7.88.1` constantly in these situations. It's a minimal image with `curl` built in. For networking debugging, that's usually all you need. If you also need DNS tools, use `nicolaka/netshoot` instead.

## Debugging a pod that won't start at all

What if the pod is stuck in a restart loop so aggressive that it never stays up long enough to attach? You can debug the pod itself rather than a running container:

```bash
kubectl debug web-app -it --image=curlimages/curl:7.88.1 --copy-to=web-app-debug
```

The `--copy-to` flag creates a *new* pod based on the original spec, but with your debug container added. The original pod keeps doing its crash loop thing. The copy gives you a stable environment to investigate.

This is particularly useful when the crash is caused by something in the init container. Your debug pod inherits the same volumes and config, so you can see exactly what the init container would see.

## Ephemeral containers (GA in 1.25)

Ephemeral containers are the proper, Kubernetes-native answer to "I need to debug a running pod." They went GA in Kubernetes 1.25, which means they're not a beta feature you're gambling on anymore.

The difference from the `kubectl debug` approach above is subtle but important. Ephemeral containers are defined in the Pod spec under `ephemeralContainers`. They can't be restarted (because they're ephemeral, the name gives it away). They don't have ports. They don't have probes. They exist purely to let you look around.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: web-app
spec:
  containers:
    - name: app
      image: nginx:1.25
      resources:
        limits:
          memory: "128Mi"
          cpu: "500m"
```

When you run `kubectl debug`, Kubernetes patches the pod's ephemeral containers list:

```bash
kubectl debug web-app -it --image=curlimages/curl:7.88.1 --target=app
```

The `--target` flag tells Kubernetes to share the process namespace with the `app` container. This means you can see its processes, its `/proc`, and its filesystem mounts. That's the real power here: you're not just in the same network namespace, you're seeing the world exactly as the crashing process sees it.

## Sharing the process namespace

Process namespace sharing is a pod-level setting. If you want ephemeral containers to see processes in a target container, the pod needs `shareProcessNamespace: true`:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: web-app
spec:
  shareProcessNamespace: true
  containers:
    - name: app
      image: nginx:1.25
```

Without this, your ephemeral container shares the network and volumes but can't see the other container's processes. You can still run `curl -s localhost:8080` and check if the app is responding, but you can't run `ls /proc/1/fd` to see what file descriptors the main process has open.

I've seen teams forget this setting and spend twenty minutes wondering why `ps aux` only shows their debug shell. It's always `shareProcessNamespace`.

## What I actually use this for

Real scenarios where ephemeral containers saved me:

**DNS debugging.** A service couldn't resolve internal hostnames. Jumped into a debug ephemeral container, ran `nslookup` against the cluster DNS, and found a typo in the service name. Thirty seconds of debugging.

**Network connectivity.** A pod couldn't reach an external API. Used `curl` from an ephemeral container to test the endpoint directly from the pod's network namespace. Turned out the egress firewall rule was wrong.

**Filesystem inspection.** A pod was reporting disk pressure but the PVC looked fine. Attached an ephemeral container and discovered the app was writing huge temp files to `/tmp` (emptyDir, not the PVC). The container's writable layer was the problem.

## A note about RBAC

You need the `pods/ephemeralcontainers` permission to create ephemeral containers. This is separate from the regular `pods/exec` permission. If your cluster has restrictive RBAC (and it should), you might need to ask your platform team for access.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-debugger
rules:
  - apiGroups: [""]
    resources: ["pods/ephemeralcontainers"]
    verbs: ["patch", "update"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
```

Don't give this to everyone. It's a debugging tool, not a toy.



Ephemeral containers solved one of the oldest operational pain points in Kubernetes. Before them, debugging a crashed container usually meant rebuilding it with debug tools baked in, or SSH-ing to the node and using `crictl` (which is a whole different level of pain). Now you can attach a diagnostic container on demand and throw it away when you're done.

The mental model is simple: your pod is a room with a broken appliance. Ephemeral containers let you bring a toolbox into the room without replacing the appliance. Sometimes that's all you need to figure out what went wrong.