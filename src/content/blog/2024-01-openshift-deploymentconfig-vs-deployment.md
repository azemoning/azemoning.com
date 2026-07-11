---
title: "DeploymentConfig Is Dead. Long Live Deployment."
slug: "openshift-deploymentconfig-vs-deployment"
date: 2024-01-11
category: "OpenShift"
tags: ["openshift", "deployment", "deploymentconfig", "kubernetes", "migration"]
readingTime: "7 min read"
excerpt: "DeploymentConfig looks like Deployment but it's not. And you should probably stop using it."
---

I'm going to say something that might annoy long-time OpenShift users: stop using DeploymentConfig.

I know. It's been there since OpenShift 3.x. It has features that Deployment doesn't. Your team has been writing DeploymentConfig YAMLs for years. But it's time to move on, and I'll explain why.

<!-- truncate -->

## What is a DeploymentConfig?

DeploymentConfig (`apps.openshift.io/v1`) is OpenShift's original deployment resource. It predates the Kubernetes Deployment (`apps/v1`). Here's what one looks like:

```yaml
apiVersion: apps.openshift.io/v1
kind: DeploymentConfig
metadata:
  name: my-app
  namespace: my-project
spec:
  replicas: 3
  selector:
    app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
      - name: my-app
        image: image-registry.openshift-image-registry.svc:5000/my-project/my-app:latest
        ports:
        - containerPort: 8080
  triggers:
  - type: ConfigChange
  - type: ImageChange
    imageChangeParams:
      automatic: true
      containerNames:
      - my-app
      from:
        kind: ImageStreamTag
        name: my-app:latest
```

If you squint, it looks like a Deployment. Same `replicas`, same `template`, same `selector`. But there are differences, and they matter.

## What makes DeploymentConfig different

### Triggers

The `triggers` field is the big one. DeploymentConfig supports two trigger types:

**ConfigChange**: When the DeploymentConfig's spec changes, automatically create a new deployment. Kubernetes Deployment does this too (it watches the pod template hash), but DeploymentConfig makes it explicit.

**ImageChange**: When the referenced ImageStream tag updates, automatically redeploy with the new image. This is the feature that made DeploymentConfig popular. Push a new image to an ImageStream, and the deployment triggers automatically.

With a Kubernetes Deployment, you'd need a separate controller (like Argo CD Image Updater or Keel) to watch for image changes and update the Deployment. DeploymentConfig does it natively.

### Deployment history

DeploymentConfig creates ReplicationControllers (not ReplicaSets) for each deployment. Each ReplicationController is a deployment version:

```bash
oc get rc -l app=my-app
```

```
NAME              DESIRED   CURRENT   READY   AGE
my-app-1         0         0         0       2d
my-app-2         0         0         0       1d
my-app-3         3         3         3       10m
```

You can roll back to a specific version:

```bash
oc rollback my-app --to-version=2
```

Kubernetes Deployment also has rollback (`kubectl rollout undo`), but it's less granular. DeploymentConfig lets you pick a specific version number.

### Lifecycle hooks

DeploymentConfig supports pre and post-deployment hooks:

```yaml
spec:
  strategy:
    rollingParams:
      pre:
        failurePolicy: Abort
        execNewPod:
          containerName: my-app
          command: ["/bin/sh", "-c", "echo 'pre-deploy hook' && /app/migrate-db.sh"]
      post:
        failurePolicy: Ignore
        execNewPod:
          containerName: my-app
          command: ["/bin/sh", "-c", "/app/verify-deployment.sh"]
```

This is useful for database migrations, health checks, and verification steps. Kubernetes Deployment doesn't have this built in (you'd use Helm hooks or a custom operator).

## Why you should use Deployment instead

Despite those nice features, DeploymentConfig is legacy. Here's why:

### The Kubernetes ecosystem uses Deployment

Every Helm chart, every tutorial, every CI/CD tool expects Deployment. If you use DeploymentConfig:

- Helm charts won't work out of the box
- Argo CD and Flux handle Deployment natively; DeploymentConfig needs custom resource hooks
- Service meshes (Istio, etc.) integrate with Deployment, not DeploymentConfig
- Kubernetes documentation covers Deployment; DeploymentConfig docs are OpenShift-only

### DeploymentConfig is feature-complete (frozen)

Red Hat has stated that DeploymentConfig is in maintenance mode. No new features. No improvements. The recommendation is to migrate to Deployment.

### Deployment has caught up

Kubernetes Deployment now has:
- `maxSurge` and `maxUnavailable` for rolling updates (same as DeploymentConfig's `rollingParams`)
- `kubectl rollout undo` for rollbacks
- `kubectl rollout status` for monitoring
- Revision history with `revisionHistoryLimit`

### ReplicationController vs ReplicaSet

DeploymentConfig creates ReplicationControllers. Kubernetes moved to ReplicaSets years ago. ReplicationController is effectively deprecated in the Kubernetes ecosystem. No new tooling targets it.

## The one thing you'll miss: ImageChange triggers

This is the real reason people stick with DeploymentConfig. The automatic redeployment when an ImageStream tag updates is genuinely useful.

The migration path for this:

**Option 1: Use Deployment with image tag `:latest` and an image updater**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
      - name: my-app
        image: image-registry.openshift-image-registry.svc:5000/my-project/my-app:latest
```

Then use a tool like Keel, Argo CD Image Updater, or a custom controller to watch the ImageStream and update the Deployment when the image changes.

**Option 2: Use `oc set triggers` on a Deployment**

OpenShift actually supports image change triggers on Deployment too, through the `DeploymentTriggerPolicy` annotation. It's less well-known:

```bash
oc set triggers deployment/my-app --from-image=my-project/my-app:latest --containers=my-app
```

This adds an image change trigger to a standard Deployment. It's an OpenShift extension to the Deployment API, so it won't work on vanilla Kubernetes, but it bridges the gap while you're on OpenShift.

**Option 3: Trigger from your CI/CD pipeline**

After building and pushing a new image, have your CI/CD pipeline update the Deployment's image:

```bash
oc set image deployment/my-app my-app=image-registry.openshift-image-registry.svc:5000/my-project/my-app:sha-abc1234
```

This is the most portable approach. Your pipeline controls the deployment, not the cluster.

## Migration steps

If you have existing DeploymentConfigs and want to migrate:

1. Export the current DeploymentConfig:
   ```bash
   oc get dc my-app -o yaml > dc.yaml
   ```

2. Convert to Deployment (manual, but straightforward):
   - Change `apiVersion` to `apps/v1`
   - Change `kind` to `Deployment`
   - Remove `triggers`
   - Change `rollingParams` to `strategy: RollingUpdate` with `maxSurge` and `maxUnavailable`
   - Change any `ImageStreamTag` references to full image paths

3. Test in a staging project first

4. Delete the DeploymentConfig and apply the Deployment:
   ```bash
   oc delete dc my-app
   oc apply -f deployment.yaml
   ```

5. Set up an alternative for image change triggers if needed

## The honest assessment

DeploymentConfig has features that Deployment doesn't (triggers, lifecycle hooks, version-based rollback). Those features are useful. But the ecosystem has moved to Deployment, and staying on DeploymentConfig means staying on a path that Red Hat itself has stopped investing in.

In a previous project, we migrated our last DeploymentConfig to Deployment about a year ago. The migration was mostly mechanical. The hardest part was replacing the ImageChange triggers, which we solved with a simple CI/CD pipeline update.

If you're starting new work on OpenShift, use Deployment. If you have existing DeploymentConfigs, plan a migration. Not urgent, but not something to keep postponing either.