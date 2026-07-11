---
title: "Helm Hooks: Controlling When Things Happen"
slug: "helm-hooks-lifecycle-orchestration"
date: 2024-08-19
category: "Helm"
tags: ["helm", "kubernetes", "hooks", "database-migrations", "helm-3"]
readingTime: "11 min read"
excerpt: "Your database migration runs before the app starts. How do you guarantee that in Helm?"
---

Your database migration runs before the app starts. How do you guarantee that in Helm?

This is the kind of question that seems simple until you try to solve it. Kubernetes Deployments don't have a "run this first" concept. Init containers run before the main container, but they're part of the same Pod. If your migration is a Job (which it should be, since it might take minutes and shouldn't restart on failure), you need something outside the Deployment lifecycle to manage it.

Helm hooks are that something.

## What hooks actually are

A Helm hook is a regular Kubernetes resource with a special annotation. That annotation tells Helm when to create, update, or delete the resource relative to the release lifecycle.

The annotation looks like this:

```yaml
annotations:
  "helm.sh/hook": pre-install,pre-upgrade
```

Helm sees this annotation and handles the resource differently from your normal templates. Instead of applying it with `helm install` or `helm upgrade`, Helm manages it according to the hook's lifecycle phase.

## The available hooks

Here's the full list, in the order they typically execute:

| Hook | When it runs |
|------|-------------|
| `pre-install` | Before any resources are created |
| `pre-upgrade` | Before any resources are updated |
| `post-install` | After all resources are created |
| `post-upgrade` | After all resources are updated |
| `pre-delete` | Before any resources are deleted |
| `post-delete` | After all resources are deleted |
| `test` | When `helm test` is run |
| `crd-install` | Before other resources (for CRDs, deprecated in Helm 3) |

You can combine multiple hooks on a single resource using commas.

## The database migration pattern

Here's the problem in concrete terms. You have:

1. A PostgreSQL database that needs schema migrations
2. A web application that connects to that database
3. Both deployed via a single Helm chart

If the app starts before the migration finishes, it crashes because the schema doesn't match. If you put the migration in an init container, you can't run it as a proper Job with backoff limits and proper error handling.

The solution: a Kubernetes Job with a `pre-install,pre-upgrade` hook.

```yaml
# templates/migration-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "myapp.fullname" . }}-migrate
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "0"
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: {{ .Values.image.repository }}:{{ .Values.image.tag }}
          command: ["./migrate"]
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: {{ include "myapp.fullname" . }}-db
                  key: url
  backoffLimit: 3
```

Let me break down those annotations:

**`"helm.sh/hook": pre-install,pre-upgrade`** - Run this Job before installing or upgrading the release. The migration completes (or fails) before Helm touches any other resource.

**`"helm.sh/hook-weight": "0"`** - If you have multiple hooks in the same phase, weight controls execution order. Lower weights run first. This is useful when you have a migration that must run before seed data, for example.

**`"helm.sh/hook-delete-policy": before-hook-creation`** - Delete the previous hook resource before creating a new one. Without this, you'd accumulate completed Job objects with each upgrade. The default policy keeps them around (for debugging), which is annoying in practice.

Other delete policies:

- `hook-succeeded` - Delete only if the hook succeeded
- `hook-failed` - Delete only if the hook failed (useful for keeping failed pods around to inspect logs)
- `before-hook-creation` - Delete before creating the new hook (my preference for most cases)

## A more realistic migration setup

In practice, you usually need to wait for the database to be ready before running migrations, and you want to make the hook optional (not every environment uses the same database setup).

```yaml
# templates/migration-job.yaml
{{- if .Values.migration.enabled }}
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "myapp.fullname" . }}-migrate
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "0"
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  template:
    spec:
      restartPolicy: Never
      initContainers:
        - name: wait-for-db
          image: busybox:1.36
          command:
            - sh
            - -c
            - |
              until nc -z {{ .Values.database.host }} {{ .Values.database.port }}; do
                echo "Waiting for database..."
                sleep 2
              done
      containers:
        - name: migrate
          image: {{ .Values.image.repository }}:{{ .Values.image.tag }}
          command: ["./migrate", "--direction", "up"]
          envFrom:
            - secretRef:
                name: {{ include "myapp.fullname" . }}-db
  backoffLimit: 3
{{- end }}
```

```yaml
# values.yaml
migration:
  enabled: true
  database:
    host: postgresql
    port: 5432
```

The init container polls until the database is reachable, then the migration runs. If the migration fails, Helm marks the release as failed and doesn't proceed with the Deployment.

## Post-install hooks for one-time setup

Not everything belongs in pre-install. Some tasks need to run after the application is deployed. A common example: registering a webhook URL or running initial data seeding.

```yaml
# templates/seed-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "myapp.fullname" . }}-seed
  annotations:
    "helm.sh/hook": post-install
    "helm.sh/hook-weight": "5"
    "helm.sh/hook-delete-policy": hook-succeeded
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: seed
          image: {{ .Values.image.repository }}:{{ .Values.image.tag }}
          command: ["./seed-data"]
```

Notice the weight is `5`. If I had another post-install hook with weight `10`, the seed job would run first. The weight system is simple but effective for ordering.

## Pre-delete hooks for cleanup

When someone runs `helm delete my-release`, you might need to clean up external resources (deregister DNS entries, remove monitoring checks, archive data).

```yaml
# templates/cleanup-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "myapp.fullname" . }}-cleanup
  annotations:
    "helm.sh/hook": pre-delete
    "helm.sh/hook-delete-policy": hook-succeeded
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: cleanup
          image: {{ .Values.image.repository }}:{{ .Values.image.tag }}
          command: ["./cleanup"]
          env:
            - name: ACTION
              value: "deregister"
```

This runs before Helm deletes the main resources, so the cleanup job can still reach services that are about to be torn down.

## Helm test hooks

The `test` hook is separate from the others. It only runs when you explicitly invoke:

```bash
helm test my-release
```

Test hooks are useful for verifying that a deployment actually works, not just that it applied successfully.

```yaml
# templates/tests/test-api.yaml
apiVersion: v1
kind: Pod
metadata:
  name: {{ include "myapp.fullname" . }}-test-api
  annotations:
    "helm.sh/hook": test
spec:
  restartPolicy: Never
  containers:
    - name: test
      image: curlimages/curl:8.4.0
      command:
        - sh
        - -c
        - |
          STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://{{ include "myapp.fullname" . }}:{{ .Values.service.port }}/health)
          if [ "$STATUS" != "200" ]; then
            echo "Health check failed with status $STATUS"
            exit 1
          fi
          echo "Health check passed"
```

You can have multiple test hooks. Helm runs them all and reports pass/fail for each.

```bash
$ helm test my-release
Pod my-app-test-api running
Pod my-app-test-api succeeded
```

## Hook weight and ordering

When you have multiple hooks in the same lifecycle phase, `helm.sh/hook-weight` controls execution order. Hooks with lower weights run first. Hooks with the same weight run in an undefined order (don't rely on alphabetical sorting or creation time).

A practical example with migrations and seed data:

```yaml
# Migration: weight 0 (runs first)
annotations:
  "helm.sh/hook": pre-install,pre-upgrade
  "helm.sh/hook-weight": "0"

# Seed data: weight 10 (runs after migration)
annotations:
  "helm.sh/hook": post-install
  "helm.sh/hook-weight": "10"
```

I use increments of 10 (0, 10, 20, 30) so there's room to insert hooks between existing ones without renumbering everything. Same principle as BASIC line numbers in the 1980s, except this time it actually works.

## Debugging failed hooks

When a hook fails, Helm marks the release as failed. To see what happened:

```bash
# Check the hook pod's logs
kubectl logs job/my-release-migrate

# See all hook resources for a release
kubectl get pods -l "helm.sh/hook" -l "helm.sh/hook-weight"
```

If you set `"helm.sh/hook-delete-policy": hook-succeeded`, failed pods stick around so you can inspect them. This is useful during development. In production, I usually switch to `before-hook-creation` to avoid accumulating dead pods.

One gotcha: Helm doesn't retry failed hooks automatically. The Job's `backoffLimit` controls retries within a single hook execution, but if the hook fails and you run `helm upgrade` again, it creates a fresh hook. This is usually what you want, but it means you can't rely on Helm to eventually succeed. Your migration needs to be idempotent.

## The argocd/flux consideration

If you're using ArgoCD or Flux for GitOps, be aware that hook behavior can differ. ArgoCD has its own hook annotations (`argocd.argoproj.io/hook`) that override Helm's hooks in some cases. Flux handles Helm hooks natively, but you might need to configure the HelmRelease resource to enable them.

Test your hooks in the GitOps context, not just with `helm install`. I've seen migrations that worked perfectly with `helm upgrade` but got skipped entirely by ArgoCD because of annotation conflicts.

## Wrapping up

Hooks give you control over the lifecycle of your deployment that plain templates can't provide. The database migration pattern alone is worth learning them for, but pre-delete cleanup and post-install verification tests are nearly as common in the charts I maintain.

The key insight is that hooks are just Kubernetes resources with annotations. There's no magic, no special API. Helm watches for those annotations and manages the resources accordingly. Once you internalize that, hooks stop being a "feature" and start being an obvious tool.
