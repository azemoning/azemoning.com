---
title: "Server-Side Apply: Who Wins When Three People Apply the Same Resource?"
slug: "server-side-apply-conflicts"
date: 2023-09-20
category: "Kubernetes"
tags: ["kubernetes", "server-side-apply", "kubectl", "gitops"]
readingTime: "9 min read"
excerpt: "Three people, three kubectl apply, one resource. Server-Side Apply finally gives you a real answer to who wins."
---

Three people, three `kubectl apply`, one resource. Who wins?

If your answer is "whoever applied last," you're technically correct. And that's exactly the problem. Client-side apply (the default `kubectl apply` behavior everyone learns first) is a last-write-wins system with no conflict detection. It's been that way since forever, and it's caused more production incidents than anyone wants to admit.

I've watched a developer push a config change to staging while the platform team was rolling out a security patch to the same Deployment. Both ran `kubectl apply`. Both succeeded. The security patch got silently overwritten. Nobody noticed until the next vulnerability scan.

Server-Side Apply (SSA) has been GA since Kubernetes 1.22. It fixes this by tracking *who owns which fields*. Not who owns the resource. Which fields.

<!-- truncate -->

## The problem with client-side apply

When you run `kubectl apply`, here's what actually happens:

1. kubectl reads your YAML file
2. kubectl fetches the current resource from the API server
3. kubectl computes a diff between your file and the last-applied annotation
4. kubectl sends a PATCH request with the changes

Step 3 is where things break. The "last-applied annotation" is just a JSON blob stored in the resource metadata. It has no concept of ownership. If two people change the same field, whoever patches last wins. There's no error, no warning, no indication that anything collided.

```bash
# Developer A changes the image
kubectl apply -f deployment-a.yaml

# Platform team changes resource limits
kubectl apply -f deployment-b.yaml

# Both succeed. Both think their change is live.
# Only one actually is.
```

## Enter Server-Side Apply

Server-Side Apply moves the merge logic from kubectl to the API server. The API server now tracks field ownership using a concept called "managed fields." Every field in every resource knows who last set it.

```bash
kubectl apply --server-side -f deployment.yaml
```

That's it. Same file, same command structure, one flag difference. But the behavior is fundamentally different.

When SSA encounters a conflict (two different managers trying to set the same field), it rejects the request. You get an actual error message telling you which field is contested and who owns it. No silent overwrites.

## Field managers

The "who" in "who owns this field" is called a field manager. By default, kubectl uses "kubectl" as the field manager name. You can (and should) customize this:

```bash
kubectl apply --server-side --field-manager=my-ci-pipeline -f deployment.yaml
```

This is a small change with big implications. Now every pipeline, every tool, every person can have a distinct identity in the managed fields tracking.

Here's a deployment that two different field managers have touched:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
  namespace: production
  managedFields:
    - manager: kubectl
      operation: Apply
      fieldsV1:
        f:spec:
          f:template:
            f:spec:
              f:containers:
                - f:image: {}
    - manager: flux
      operation: Apply
      fieldsV1:
        f:spec:
          f:replicas: {}
          f:template:
            f:spec:
              f:containers:
                - f:resources:
                    f:limits:
                      f:cpu: {}
                      f:memory: {}
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1.25
          resources:
            limits:
              cpu: "500m"
              memory: "128Mi"
```

The `managedFields` section tells you that `kubectl` owns the container image and `flux` owns the resource limits. If a CI pipeline tries to change the resource limits, SSA will reject it because those fields belong to flux.

## Force conflicts

Sometimes you do want to take ownership. Maybe the team that originally set a field is gone, or you're doing a migration, or you've decided your tool should be the canonical owner of certain fields.

```bash
kubectl apply --server-side --force-conflicts -f deployment.yaml
```

This tells the API server: "I know there are conflicts. I want to take ownership of these fields anyway." It's the override mechanism. Use it deliberately.

In a GitOps workflow, this might look like:

```bash
# Your GitOps tool owns everything it applies
kubectl apply --server-side --field-manager=flux --force-conflicts -f deployment.yaml
```

After this, flux owns every field it set. Future conflicts from other managers will be rejected unless they also force.

## SSA and subresources

One thing that tripped me up early on: SSA works with status subresources too. If you're building a controller that sets `.status.conditions`, SSA lets you own just the status fields without touching the spec.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
status:
  conditions:
    - type: Available
      status: "True"
      lastTransitionTime: "2023-09-20T10:00:00Z"
      reason: MinimumReplicasAvailable
      message: "Deployment has minimum availability."
```

This matters because it means your custom controller and `kubectl` can both manage the same resource without stepping on each other. The controller owns status, kubectl owns spec. Clean separation.

## Migrating from client-side to server-side

The migration path is straightforward but has one gotcha. When you switch to SSA for the first time on an existing resource, the API server needs to reconcile the existing managed fields annotation from client-side apply with SSA's tracking.

```bash
# First SSA apply on an existing resource
kubectl apply --server-side --force-conflicts -f deployment.yaml
```

You'll likely need `--force-conflicts` on the first run because the API server sees fields that were previously managed by client-side apply as a different "owner." After that first apply, subsequent SSA applies work normally.

I recommend doing this migration one namespace at a time. Start with dev, watch the `managedFields` section grow, and make sure your tools handle conflict errors gracefully before touching production.

## What this means for GitOps

If you're running Flux or ArgoCD, SSA is probably already relevant to you. Both tools have been moving toward SSA as the default apply mechanism. The reason is simple: GitOps operators need to be authoritative about the fields they manage, and client-side apply gives them no way to enforce that.

With SSA, a GitOps tool can say "I own the spec of every resource in this namespace" and any manual `kubectl edit` by a developer will either conflict (alerting the GitOps tool to revert it) or succeed (if the developer forces conflicts, which at least creates an audit trail in managedFields).

This doesn't eliminate configuration drift. But it makes drift visible and attributable, which is the first step to actually dealing with it.

## Checking managed fields

You can inspect the managed fields of any resource:

```bash
kubectl get deployment web-app -o jsonpath='{.metadata.managedFields}' | jq .
```

This shows you every field manager, what operation they performed, and which fields they own. It's verbose, but it's the ground truth of who changed what.

When debugging SSA conflicts, this is the first thing I look at. The conflict error message tells you which field is contested, and the managed fields tell you who currently owns it.



Server-Side Apply didn't change how Kubernetes works at the object level. Your Deployments, Services, and ConfigMaps are the same resources they always were. What changed is the contract around how those resources get modified. Instead of a free-for-all where the last apply wins, you get a system that tracks ownership and enforces boundaries.

If you're still running plain `kubectl apply` in production, try adding `--server-side` on your next deployment. The first time you see a conflict error instead of a silent overwrite, you'll understand why this matters.