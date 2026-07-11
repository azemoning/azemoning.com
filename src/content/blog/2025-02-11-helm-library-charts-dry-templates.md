---
title: "Library Charts and the Death of Copy-Paste Templates"
slug: "helm-library-charts-dry-templates"
date: 2025-02-11
category: "Helm"
tags: ["helm", "kubernetes", "library-charts", "templates", "helm-3"]
readingTime: "13 min read"
excerpt: "You have 5 charts that all need the same labels, annotations, and helper functions. Copy-paste isn't the answer."
---

You have 5 charts that all need the same labels, annotations, and helper functions. Copy-paste isn't the answer.

I know this because I did it. For about 18 months, every chart in our org had its own `_helpers.tpl` file with the same 40 lines of label definitions, the same fullname logic, and the same selector label pattern. When we changed our labeling convention (adding a team label), I updated 12 charts by hand. Took an afternoon. Missed two. Found out when the monitoring dashboards broke.

Library charts solve this. They've been available since Helm 3.6, and as of Helm 3.16 (the current release), they're mature and well-supported. If you maintain multiple charts that share common logic, this is the single most impactful structural change you can make.

## What a library chart is

A library chart is a Helm chart that contains only template definitions. It doesn't deploy anything. You can't install it. It exists solely to provide reusable templates that other charts can consume.

The distinction is in `Chart.yaml`:

```yaml
apiVersion: v2
name: common
description: Shared Helm templates for our organization
type: library
version: 1.2.0
```

The `type: library` field is what makes it a library chart. Without it (or with `type: application`), Helm treats it as a regular chart that can be installed.

## Creating a library chart

Let's build one from scratch. The typical use case: shared labels, common annotations, and utility templates that every chart in your org needs.

```bash
mkdir -p common/templates
```

The `Chart.yaml`:

```yaml
apiVersion: v2
name: common
description: Shared Helm library chart
type: library
version: 1.0.0
```

No `values.yaml` needed (though you can include one if your templates reference default values).

Now the templates. Start with `templates/_labels.tpl`:

```yaml
{{/*
Standard labels for all resources.
*/}}
{{- define "common.labels" -}}
helm.sh/chart: {{ include "common.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: {{ include "common.partOf" . }}
app.kubernetes.io/team: {{ .Values.team | default "platform" }}
{{- end }}

{{/*
Chart label.
*/}}
{{- define "common.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{/*
Part-of label. Defaults to chart name, can be overridden.
*/}}
{{- define "common.partOf" -}}
{{- default .Chart.Name .Values.partOf -}}
{{- end }}
```

Then `templates/_fullname.tpl`:

```yaml
{{/*
Fully qualified app name.
Usage: {{ include "common.fullname" . }}
*/}}
{{- define "common.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}
```

And `templates/_annotations.tpl`:

```yaml
{{/*
Standard annotations.
*/}}
{{- define "common.annotations" -}}
app.kubernetes.io/created-by: helm
helm.sh/revision: {{ .Release.Revision | quote }}
{{- end }}
```

And a utility template in `templates/_utils.tpl`:

```yaml
{{/*
Merge multiple dicts. Usage: include "common.merge" (list $dict1 $dict2)
The last dict wins on conflicts.
*/}}
{{- define "common.merge" -}}
{{- $result := dict -}}
{{- range . -}}
{{- $result = mergeOverwrite $result . -}}
{{- end -}}
{{- toYaml $result -}}
{{- end -}}

{{/*
Convert a map to environment variables.
Usage: include "common.envFromMap" (dict "prefix" "APP_" "map" .Values.extraEnv)
*/}}
{{- define "common.envFromMap" -}}
{{- $prefix := .prefix -}}
{{- range $key, $value := .map }}
- name: {{ $prefix }}{{ $key }}
  value: {{ $value | quote }}
{{- end -}}
{{- end -}}
```

The final structure:

```
common/
  Chart.yaml
  templates/
    _labels.tpl
    _fullname.tpl
    _annotations.tpl
    _utils.tpl
```

## Using a library chart as a dependency

To consume the library, add it as a dependency in your application chart's `Chart.yaml`:

```yaml
apiVersion: v2
name: my-api
version: 0.3.0
type: application
dependencies:
  - name: common
    version: "1.x.x"
    repository: "oci://ghcr.io/myorg/charts"
```

Run `helm dependency update` and the library chart gets downloaded into `charts/common/`.

Now in your application's templates, you can call the library's named templates:

```yaml
# templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "common.fullname" . }}
  labels:
    {{- include "common.labels" . | nindent 4 }}
    app.kubernetes.io/component: api
  annotations:
    {{- include "common.annotations" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      app.kubernetes.io/name: {{ include "common.fullname" . }}
  template:
    metadata:
      labels:
        {{- include "common.labels" . | nindent 8 }}
        app.kubernetes.io/name: {{ include "common.fullname" . }}
        app.kubernetes.io/component: api
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          {{- if .Values.extraEnv }}
          env:
            {{- include "common.envFromMap" (dict "prefix" "API_" "map" .Values.extraEnv) | nindent 12 }}
          {{- end }}
```

Every label, annotation, and naming convention comes from the library. Change the library once, and every chart that depends on it picks up the change on the next `helm dependency update` and redeploy.

## Include vs template

This distinction matters more when working with library charts. Use `include`, not `template`.

```yaml
# This works but you can't pipe the output
{{- template "common.labels" . }}

# This works AND you can pipe
{{- include "common.labels" . | nindent 4 }}
```

The `template` action writes directly to the output. The `include` function returns a string that you can pipe through `nindent`, `indent`, `trim`, or any other function. In practice, `include` is almost always what you want.

There's one case where `template` is useful: when you're defining a template inside another template (nested definitions). But that's rare and usually a sign you should refactor.

## Values merging with library charts

Library charts can reference `.Values`, but the values come from the consuming chart, not the library. This is important to understand.

If your library template does:

```yaml
{{- define "common.labels" -}}
app.kubernetes.io/team: {{ .Values.team | default "platform" }}
{{- end }}
```

Then the consuming chart needs to provide `team` in its `values.yaml`:

```yaml
# my-api/values.yaml
team: backend
replicaCount: 3
```

The library chart's own `values.yaml` (if it had one) is ignored during rendering. Only the consuming chart's values are used.

This means you should document what values your library expects. I add a comment block at the top of each template file:

```yaml
{{/*
Required values:
  - team (string): Team label value, defaults to "platform"
  - partOf (string, optional): Part-of label, defaults to chart name

Optional values:
  - fullnameOverride (string): Override the generated resource name
  - nameOverride (string): Override the chart name in fullname generation
*/}}
```

## A real-world library chart

Here's a more complete library that handles common patterns I've needed across multiple charts.

`templates/_deployment.tpl`:

```yaml
{{/*
Standard deployment container spec.
Usage: include "common.containerSpec" (dict "Values" .Values "Chart" .Chart)
*/}}
{{- define "common.containerSpec" -}}
name: {{ .Chart.Name }}
image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
imagePullPolicy: {{ .Values.image.pullPolicy | default "IfNotPresent" }}
{{- if .Values.resources }}
resources:
  {{- toYaml .Values.resources | nindent 2 }}
{{- end }}
{{- if .Values.livenessProbe }}
livenessProbe:
  {{- toYaml .Values.livenessProbe | nindent 2 }}
{{- end }}
{{- if .Values.readinessProbe }}
readinessProbe:
  {{- toYaml .Values.readinessProbe | nindent 2 }}
{{- end }}
{{- end }}
```

`templates/_service.tpl`:

```yaml
{{/*
Standard service spec.
Usage: include "common.serviceSpec" (dict "Values" .Values "Release" .Release)
*/}}
{{- define "common.serviceSpec" -}}
type: {{ .Values.service.type | default "ClusterIP" }}
ports:
  - port: {{ .Values.service.port | default 80 }}
    targetPort: {{ .Values.service.targetPort | default .Values.service.port | default 80 }}
    protocol: TCP
    name: http
selector:
  app.kubernetes.io/name: {{ include "common.fullname" . }}
{{- end }}
```

Now a consuming chart's deployment template becomes minimal:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "common.fullname" . }}
  labels:
    {{- include "common.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      app.kubernetes.io/name: {{ include "common.fullname" . }}
  template:
    metadata:
      labels:
        {{- include "common.labels" . | nindent 8 }}
    spec:
      containers:
        - {{- include "common.containerSpec" (dict "Values" .Values "Chart" .Chart) | nindent 10 }}
```

## Publishing a library chart

Package and push like any other chart:

```bash
helm package ./common
helm push common-1.0.0.tgz oci://ghcr.io/myorg/charts
```

Consumers update by bumping the version constraint in their `Chart.yaml`:

```yaml
dependencies:
  - name: common
    version: "1.x.x"  # semver range, gets latest 1.x
    repository: "oci://ghcr.io/myorg/charts"
```

I recommend using semver ranges (`1.x.x` or `~1.2.0`) so consumers get patch fixes automatically but don't get breaking changes without explicitly bumping.

## When not to use library charts

Library charts add indirection. Someone reading your application chart has to look in two places to understand what a template renders. For a small org with 2-3 charts, the overhead might not be worth it. Just maintain the `_helpers.tpl` in each chart and accept the duplication.

The break-even point I've seen is around 5 charts. Below that, duplication is manageable. Above that, the library chart saves enough maintenance time to justify the added complexity.

Also, library charts can't be installed or tested independently. You test them through the consuming charts. This means you need integration tests that install a real chart and verify the library's templates render correctly. Unit testing with `helm unittest` or `helm template` helps, but it doesn't catch everything.

## Migrating existing charts to use a library

The migration path is straightforward but tedious:

1. Create the library chart with your common templates
2. In each consuming chart, add the library as a dependency
3. Replace local `_helpers.tpl` definitions with calls to the library's templates
4. Test each chart with `helm template` to verify the output is identical
5. Deploy to a staging environment and verify
6. Update production

Step 4 is critical. A missing newline or different indentation from the library template can change your Kubernetes resources in subtle ways. Always diff the `helm template` output before and after migration.

I've done this migration twice now. The first time, I skipped the diff step and spent two hours debugging a service selector mismatch that changed zero lines of visible output (it was an extra trailing space). The second time, I diffed every chart. Took 10 minutes per chart, no surprises.

Trust the diff. Don't trust your eyes.
