---
title: "A Node Dies Mid-Rollout: PodDisruptionBudgets Save Your Uptime"
slug: pod-disruption-budgets-kubernetes
date: 2022-02-08
category: "Kubernetes"
tags: ["availability", "pdb", "deployments", "operations"]
readingTime: "7 min"
excerpt: "You're doing a rolling update. Halfway through, a node dies. How many pods stay running? PDBs decide."
---

You're doing a rolling update. Halfway through, a node dies. How many pods stay running?

If you haven't set a PodDisruptionBudget, the answer is "whoever Kubernetes feels like keeping." That's not an exaggeration. Without a PDB, the eviction controller doesn't care about your availability. It'll happily drain nodes and kill pods until your service is down.

I learned this the hard way during a cluster upgrade a few months back. We had six replicas of our API service. The rolling update was mid-flight (three new pods, three old pods). A node running two of the old pods got preempted by our cloud provider (spot instance, my mistake). We dropped to one healthy pod serving production traffic for about forty seconds. The on-call alarm fired. Users noticed.

A PodDisruptionBudget would have prevented that.

## What a PDB actually does

A PDB tells Kubernetes: "when evicting voluntary disruptions, never go below this threshold." It's a contract between you and the eviction controller. Voluntary disruptions include node drains, cluster upgrades, and autoscaler scale-downs. Involuntary disruptions (node crashes, OOM kills, hardware failures) are outside its scope. A PDB can't save you from a kernel panic. It can save you from `kubectl drain`.

The resource is part of `policy/v1` (it went GA in 1.21, and we're well past that now at 1.23). Here's a basic one:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-pdb
  namespace: production
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: api-server
```

This says: at any given time, at least 2 pods matching `app: api-server` must be running. If a drain would drop below 2, Kubernetes blocks it and retries later.

You can also express it as a percentage:

```yaml
spec:
  maxUnavailable: "25%"
  selector:
    matchLabels:
      app: api-server
```

This means up to 25% of pods can be disrupted. For a 12-replica deployment, that's 3 pods. The 4th disruption gets blocked.

I prefer `maxUnavailable` for most cases. It scales naturally with replica count. `minAvailable` is better when you have a hard floor (like "I need at least 3 etcd nodes alive").

## Pairing PDBs with Deployments

PDBs work alongside Deployments, not instead of them. Your Deployment already has a rolling update strategy:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
  namespace: production
spec:
  replicas: 4
  selector:
    matchLabels:
      app: api-server
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: api-server
    spec:
      containers:
        - name: api
          image: nginx:1.21
          ports:
            - containerPort: 80
```

The Deployment's `maxUnavailable: 0` means during a rollout, Kubernetes creates new pods before terminating old ones (with `maxSurge: 1`, it creates one extra at a time). That handles the planned rollout.

The PDB handles the unplanned stuff. If someone runs `kubectl drain node-3` while the rollout is happening, the PDB protects you. The drain will wait for available pods to respect the budget.

Here's how I'd pair them: set the Deployment's `maxUnavailable` to 0 (or a low number) for controlled rollouts, and set the PDB's `maxUnavailable` to 1 for disruption tolerance. They serve different purposes and complement each other.

## What goes wrong

**PDB too tight.** Setting `minAvailable` equal to your replica count means no voluntary disruption can ever happen. Nodes can't drain. Cluster upgrades stall. Autoscalers can't scale down. I've seen teams accidentally make their clusters unmaintainable because their PDB says "all 5 pods must be running" on a 5-replica deployment.

**Forgetting the PDB during scale-down.** If you reduce replicas from 10 to 3, but your PDB says `minAvailable: 5`, the scale-down will hang. Delete or adjust the PDB first.

**No PDB on stateful workloads.** If you're running a StatefulSet with a database, you absolutely need a PDB. Losing the primary and a replica simultaneously during a node drain is how you lose data.

## Checking your PDBs

```bash
kubectl get pdb -A
```

Shows all PDBs across namespaces. The output includes `MIN AVAILABLE`, `MAX ALLOWED`, and `CURRENT` pod counts. If `ALLOWED` is 0, no disruptions are permitted right now. That's expected during peak load or partial outages. If it's 0 and you're trying to drain a node, the drain will wait.

Go set one up for your production workloads. It takes five minutes and it'll save you from a 5 AM page.