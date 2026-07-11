---
title: "Kubernetes 1.24 Killed Two Things: Docker and Your Excuse for Bad Pod Security"
slug: pod-security-admission-kubernetes-124
date: 2022-06-21
category: "Kubernetes"
tags: ["security", "psp", "pod-security-admission", "dockershim"]
readingTime: "9 min"
excerpt: "Everyone talked about dockershim removal. Nobody talked about Pod Security Admission replacing PSP. That's the bigger deal."
---

Kubernetes 1.24 removed dockershim. But that's not the biggest security change in this release.

I know, I know. The dockershim removal got all the headlines. Twitter (it was still Twitter then) was full of panic. "Docker is dead!" "Kubernetes doesn't support containers anymore!" None of that was accurate, and by now most people have moved on. containerd or CRI-O handles the runtime. Docker images still work fine. The drama was overblown.

What flew under the radar was Pod Security Admission going beta in 1.23 and maturing toward GA. This is the replacement for PodSecurityPolicy, and it's a fundamentally better approach.

## PSP was the right idea with the wrong execution

PodSecurityPolicy (PSP) was a cluster-level admission controller that restricted what pods could do. Run as root? Denied. Use host networking? Denied. Mount the Docker socket? Denied. In theory, it was exactly what you'd want.

In practice, PSP was a mess. The authorization model was confusing (you needed to grant access to the PSP itself through RBAC, which created a chicken-and-egg problem). The policies were opaque. Nobody could look at a PSP and quickly understand what it allowed. Debugging was awful. I once spent half a day figuring out why a pod was being rejected, only to find a missing `allowedCapabilities` field in a sea of YAML.

The Kubernetes SIG-Security team agreed PSP was unsalvageable. They deprecated it in 1.21 (scheduled for removal in 1.25) and built something better.

## Pod Security Admission is simpler by design

PSA works through namespace labels. That's it. You label a namespace with a security profile, and all pods created in that namespace must comply. No CRDs, no admission webhooks, no complex RBAC wiring.

There are three profiles:

- **privileged** , unrestricted (default for kube-system)
- **baseline** , prevents known escalations (host networking, privileged containers, most volume types)
- **restricted** , hardened (no root, no privilege escalation, read-only root filesystem, dropped capabilities)

You apply them through labels:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    pod-security.kubernetes.io/enforce: baseline
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/audit: restricted
```

This does three things:
1. **enforce: baseline** , rejects pods that violate the baseline profile
2. **warn: restricted** , warns (but allows) pods that violate the restricted profile
3. **audit: restricted** , logs violations to the audit log

That warn-then-enforce workflow is the killer feature. You can see what would break under a stricter profile without actually breaking anything. Promote from warn to enforce when you're ready.

## A restricted namespace in practice

Let me show you what a restricted namespace looks like, with a deployment that complies:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: secure-apps
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: secure-apps
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: api
          image: nginx:1.23
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsUser: 1000
            capabilities:
              drop:
                - ALL
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: cache
              mountPath: /var/cache/nginx
      volumes:
        - name: tmp
          emptyDir: {}
        - name: cache
          emptyDir: {}
```

Every field in that `securityContext` block is required by the restricted profile. Drop any one of them and PSA will reject the pod (or warn, depending on your mode). The `emptyDir` volumes for `/tmp` and the nginx cache directory are there because we set `readOnlyRootFilesystem: true`.

## What about the dockershim thing?

Since we're here: 1.24 removed the built-in dockershim. If you were using Docker as your container runtime, you needed to switch to containerd or CRI-O. Most managed Kubernetes services (EKS, GKE, AKS) handled this transparently. Self-managed clusters needed manual migration.

But honestly, if you're still thinking about the dockershim in mid-2022, you're behind. The real work is securing your workloads. PSA makes that dramatically easier than PSP ever did.

## My take

PSP removal was the right call. I'll die on this hill. A security mechanism that nobody understands and everybody avoids is worse than no mechanism at all. At least with no mechanism, people know they're unprotected. PSP gave a false sense of security to teams who enabled it without understanding it.

PSA is opinionated in the right ways. The three profiles cover real-world use cases. The namespace-label approach means you can roll it out incrementally. And the warn mode lets you find problems before they become outages.

Start with `warn: baseline` on your production namespaces. Watch the warnings for a week. Fix what breaks. Then enforce. It's not glamorous work, but it's the kind of thing that prevents the incident you'll never hear about (which is the best kind of prevention).