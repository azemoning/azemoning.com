---
title: "Building Helm Charts the Right Way"
slug: "building-helm-charts-right"
date: 2023-04-22
category: "Helm"
tags: ["helm", "kubernetes", "helm-3", "values-yaml", "chart-design"]
readingTime: "14 min read"
excerpt: "Every team eventually builds their own Helm chart. Here's how to do it right from the start."
---

Every team eventually builds their own Helm chart. Maybe you start with a community chart and customize it. Maybe you start from scratch because the community chart doesn't fit your deployment model. Either way, you end up owning a chart, and how you structure it determines how much pain you'll feel six months later.

I've built and maintained charts for services ranging from simple HTTP APIs to stateful systems with init containers, migration jobs, and sidecar proxies. The patterns that work are consistent, and the mistakes are predictable.

## Start with helm create

Helm 3 ships with a scaffolding command that gives you a reasonable starting point:

```bash
helm create my-service
```

This generates:

```
my-service/
  Chart.yaml
  values.yaml
  templates/
    deployment.yaml
    service.yaml
    ingress.yaml
    serviceaccount.yaml
    _helpers.tpl
    tests/
      test-connection.yaml
    NOTES.txt
  .helmignore
```

The default templates are good enough to install out of the box. Don't delete them and start from scratch. Modify them.

The `Chart.yaml` uses `apiVersion: v2` in Helm 3:

```yaml
apiVersion: v2
name: my-service
description: Internal API service
type: application
version: 0.1.0
appVersion: "1.2.0"
```

The `type` field matters. Setting it to `application` means this chart deploys workloads. Setting it to `library` means it only provides templates for other charts to use (more on that in a separate post).

## Values.yaml design is where most charts go wrong

The default `values.yaml` from `helm create` is verbose. That's intentional. It shows you every knob available. Your job is to trim it down to the knobs your users actually need.

Here's my approach:

**Start with the minimum viable values.** What does someone need to change to deploy this in their environment? Usually it's the image tag, resource limits, and maybe the replica count. Everything else should have sensible defaults.

```yaml
image:
  repository: registry.example.com/my-service
  tag: ""  # defaults to appVersion

replicaCount: 2

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 256Mi
```

**Group related settings under clear keys.** I've seen charts where database connection settings were scattered across three different top-level keys. Don't do that.

```yaml
database:
  host: ""
  port: 5432
  name: myapp
  existingSecret: ""  # use a pre-existing secret for credentials
```

**Use `existingSecret` patterns.** Don't put passwords in `values.yaml`. Let users reference a Kubernetes Secret they've already created:

```yaml
env:
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: {{ .Values.database.existingSecret }}
        key: password
```

This avoids the nightmare of credentials checked into version control.

## The _helpers.tpl file

Every chart should have a `_helpers.tpl` file with these standard definitions:

```yaml
{{/*
Chart name truncated to 63 chars.
*/}}
{{- define "my-service.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name.
*/}}
{{- define "my-service.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "my-service.labels" -}}
helm.sh/chart: {{ include "my-service.chart" . }}
app.kubernetes.io/name: {{ include "my-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Chart label.
*/}}
{{- define "my-service.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Selector labels (subset used in matchLabels).
*/}}
{{- define "my-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "my-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
```

Use `include` instead of `template` for calling named templates. The `include` function lets you pipe the output through other functions, while `template` just writes directly:

```yaml
# Good
metadata:
  labels:
    {{- include "my-service.labels" . | nindent 4 }}

# Also works, but less flexible
metadata:
  labels:
    {{- template "my-service.labels" . }}
```

## Deployment template patterns

The deployment template is where the real customization happens. Here are patterns I include in every chart:

**Optional ingress:**

```yaml
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "my-service.fullname" . }}
  labels:
    {{- include "my-service.labels" . | nindent 4 }}
spec:
  ingressClassName: {{ .Values.ingress.className }}
  rules:
    - host: {{ .Values.ingress.host }}
      http:
        paths:
          - path: {{ .Values.ingress.path }}
            pathType: {{ .Values.ingress.pathType }}
            backend:
              service:
                name: {{ include "my-service.fullname" . }}
                port:
                  number: {{ .Values.service.port }}
{{- end }}
```

Note the use of `networking.k8s.io/v1` (not `v1beta1`, which was removed in Kubernetes 1.22). By 2023, there's no reason to use the beta API.

**Environment-specific values files:**

```bash
# Development
helm install my-service ./my-service -f values-dev.yaml

# Production
helm install my-service ./my-service -f values-production.yaml
```

Keep `values.yaml` with defaults suitable for development. Create separate files for staging and production that override only what's different:

```yaml
# values-production.yaml
replicaCount: 5

resources:
  requests:
    cpu: 500m
    memory: 512Mi
  limits:
    cpu: 2000m
    memory: 2Gi

database:
  host: db-prod.internal.example.com
  existingSecret: my-service-prod-db
```

## Helm template for dry runs

One of the best features in Helm 3: `helm template` renders your chart locally without talking to a cluster:

```bash
helm template my-service ./my-service -f values-production.yaml
```

This outputs the final Kubernetes manifests. Use it in CI to catch template errors before deploying:

```bash
helm template my-service ./my-service -f values-production.yaml > rendered.yaml
kubectl apply --dry-run=client -f rendered.yaml
```

I run this in every PR pipeline. It catches missing values, bad indentation, and API version issues before they hit a cluster.

## Dependency management in Helm 3

Dependencies go directly in `Chart.yaml` now, not in a separate `requirements.yaml`:

```yaml
apiVersion: v2
name: my-service
version: 0.1.0
dependencies:
  - name: postgresql
    version: "12.x.x"
    repository: "https://charts.bitnami.com/bitnami"
    condition: postgresql.enabled
  - name: redis
    version: "17.x.x"
    repository: "https://charts.bitnami.com/bitnami"
    condition: redis.enabled
```

The `condition` field lets users disable sub-charts:

```yaml
# values.yaml
postgresql:
  enabled: false  # skip postgresql, use external DB instead
```

After adding dependencies:

```bash
helm dependency update ./my-service
```

This downloads the charts into `charts/` and creates a `Chart.lock` file (similar to `package-lock.json`). Commit the lock file.

## Test your chart

Helm 3 includes test support. Add test pods in `templates/tests/`:

```yaml
# templates/tests/test-connection.yaml
apiVersion: v1
kind: Pod
metadata:
  name: "{{ include "my-service.fullname" . }}-test-connection"
  annotations:
    "helm.sh/hook": test
spec:
  containers:
    - name: wget
      image: busybox:1.36
      command: ['wget']
      args: ['{{ include "my-service.fullname" . }}:{{ .Values.service.port }}']
  restartPolicy: Never
```

Run tests after installing:

```bash
helm test my-service
```

If the pod exits 0, the test passes. Simple, but effective for catching issues like wrong port numbers or missing services.

## What I'd do differently

Looking back at charts I've maintained, the biggest regret is not standardizing the values schema early. We had three services with similar charts but different key names for the same concepts. `dbHost` vs `database.host` vs `postgres.host`. Pick a convention and stick with it across all your charts.

The other thing: don't over-template. I've seen charts with 15 helper functions where 4 would have done the job. Every abstraction has a cost. If someone reading your chart has to jump between five files to understand what a single resource looks like, you've over-engineered it.

Keep it simple. Make the common cases easy. Let people override what they need to. That's the whole point.
