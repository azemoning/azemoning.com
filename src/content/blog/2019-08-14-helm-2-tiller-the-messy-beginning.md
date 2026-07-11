---
title: "Helm 2, Tiller, and the Messy Beginning of Kubernetes Package Management"
slug: "helm-2-tiller-the-messy-beginning"
date: 2019-08-14
category: "Helm"
tags: ["helm", "kubernetes", "tiller", "devops", "helm-2"]
readingTime: "12 min read"
excerpt: "In 2019, deploying to Kubernetes meant writing YAML. Lots of YAML. Helm 2 tried to fix that, but came with its own baggage."
---

In 2019, deploying to Kubernetes meant writing YAML. Lots of YAML. Every team I worked with had some variation of the same problem: a folder full of Kubernetes manifests, copy-pasted between projects with minor tweaks, and nobody was quite sure which version was deployed where.

Helm 2 was the first real attempt at solving this. It called itself a "package manager for Kubernetes," and the idea was sound: bundle your manifests into a reusable package (a "chart"), templatize the parts that change between environments, and let a tool handle the rest.

The problem was Tiller.

## What Tiller actually did

Helm 2 had a client-server architecture. The CLI tool (`helm`) ran on your laptop or CI server, but the actual work of talking to the Kubernetes API happened inside a pod called Tiller that ran in your cluster, usually in the `kube-system` namespace.

This meant your Helm client didn't need direct Kubernetes credentials. Tiller held the cluster-wide permissions and executed everything on your behalf. Sounds reasonable on paper.

In practice, it was a security headache that haunted platform teams for years.

## Installing Tiller (and the RBAC ceremony)

Before you could use Helm at all, you had to set up Tiller. The quick-and-dirty way that most blog posts showed:

```bash
helm init
```

That gave Tiller full admin access to your cluster. Fine for a dev environment. Absolutely not fine for production, or any cluster where more than one person had access.

The responsible way involved creating a ServiceAccount and binding it:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: tiller
  namespace: kube-system
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: tiller-cluster-admin
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
subjects:
  - kind: ServiceAccount
    name: tiller
    namespace: kube-system
```

Then:

```bash
helm init --service-account tiller
```

Most people just used `cluster-admin` because figuring out the minimum permissions Tiller actually needed was genuinely difficult. I spent an afternoon once trying to scope it down for a multi-tenant cluster and gave up. The documentation was not helpful.

## Your first Helm 2 chart

Assuming Tiller was running, creating a chart was straightforward:

```bash
helm create my-app
```

This generated a `charts/` directory structure:

```
my-app/
  Chart.yaml
  values.yaml
  charts/
  templates/
    deployment.yaml
    service.yaml
    _helpers.tpl
```

The `Chart.yaml` was simple:

```yaml
apiVersion: v1
name: my-app
version: 0.1.0
description: A Helm chart for my application
```

Note `apiVersion: v1`. That was the only option in Helm 2. (Helm 3 later introduced `v2` for `Chart.yaml`.)

## Installing a release

The install command in Helm 2 used the `--name` flag:

```bash
helm install --name my-release ./my-app
```

This was different from Helm 3, where the release name comes first with no flag:

```bash
# Helm 3 style (for comparison)
helm install my-release ./my-app
```

A small difference, but it trips people up when they read old blog posts. If you see `--name` in a Helm command, that's Helm 2 syntax.

## Dependencies lived in requirements.yaml

Helm 2 managed chart dependencies through a separate file called `requirements.yaml`:

```yaml
dependencies:
  - name: postgresql
    version: 6.3.12
    repository: https://kubernetes-charts.storage.googleapis.com/
  - name: redis
    version: 9.5.5
    repository: https://kubernetes-charts.storage.googleapis.com/
```

After adding dependencies, you ran:

```bash
helm dependency update
```

This downloaded the dependency charts into the `charts/` subdirectory. The public chart repository at `kubernetes-charts.storage.googleapis.com` was the main source for community charts. (Google shut this down in 2020, which caused a minor panic.)

Helm 3 later merged this into `Chart.yaml` under the same `dependencies:` key and removed the need for a separate file. But in 2019, `requirements.yaml` was the way.

## The things that actually frustrated people

Beyond Tiller's security model, there were practical annoyances:

**No dry-run that showed you real output.** `helm install --dry-run` sent the request to Tiller, which validated against the cluster, but didn't show you the final rendered templates in a useful way. You ended up running `helm template` (which was added later) or piping through `helm install --debug --dry-run` and squinting at the output.

**Rollbacks were clunky.** `helm rollback my-release 1` worked, but figuring out which revision to roll back to meant running `helm history my-release` and parsing through the list.

**No library charts.** If you had common template logic shared across five charts, you copied and pasted it. `_helpers.tpl` within a single chart was fine, but sharing helpers across charts wasn't supported.

**Deleting a release didn't clean up everything.** Certain resources (like CRDs or PVCs) would stick around after `helm delete`. This was by design, but it surprised a lot of people.

## What we did anyway

Despite the problems, Helm 2 was genuinely useful. At a previous job, we managed about 30 microservices with Helm charts. The alternative was maintaining hundreds of raw YAML files with `sed` commands in our CI pipeline. I know because that's what we migrated from.

The templating system was simple but effective. Values files let you define per-environment overrides:

```bash
helm install --name my-release ./my-app -f values-production.yaml
```

And the `_helpers.tpl` file let you define reusable template snippets:

```yaml
{{- define "myapp.fullname" -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
```

This pattern (prefixing resource names with the release name) became standard practice across every Helm chart I've seen.

## The transition to Helm 3

By late 2019, the Helm team was already working on Helm 3. The big change: removing Tiller entirely. Helm 3 would run as a client-only tool, talking directly to the Kubernetes API using your existing kubeconfig permissions.

This was the right call. Tiller's server-side component solved a problem (centralized release management) that most teams didn't actually have, while creating problems (security, RBAC complexity) that everyone felt.

If you're maintaining Helm 2 charts today, migrate. The syntax changes are minor, and the Tiller removal alone is worth the effort. Helm 2 reached end-of-life in November 2020, and the security implications of running an unsupported Tiller instance in your cluster are not theoretical.

## Closing thoughts

Helm 2 was a v1 product with v1 problems. It proved that Kubernetes needed a package manager, and it established patterns (charts, values, templates, releases) that carried forward into Helm 3 mostly unchanged. The architecture was flawed, but the abstractions were right.

I still have a soft spot for it, honestly. Before Helm, deploying a complex application to Kubernetes felt like assembling furniture without instructions. Helm 2 at least gave you the instructions. They were occasionally wrong, and there was always a leftover screw (Tiller), but it was better than guessing.
