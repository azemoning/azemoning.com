---
title: "Stop Hosting Your Helm Charts on GitHub Releases"
slug: "chart-distribution-oci-registries"
date: 2024-02-08
category: "Helm"
tags: ["helm", "oci", "container-registry", "chartmuseum", "helm-3"]
readingTime: "10 min read"
excerpt: "Your charts shouldn't live in a GitHub repo's releases page. OCI registries solve chart distribution properly."
---

Your charts shouldn't live in a GitHub repo's releases page.

I say this knowing that half the Helm charts I've used in production were distributed exactly this way: someone builds a chart, packages it as a `.tgz` file, attaches it to a GitHub release, and calls it done. It works, technically. So does storing config files in a shared Google Drive folder. That doesn't make it a good idea.

The problem is discoverability, versioning, and authentication. When you need to pull a chart, you need to know which repo it lives in, which version is current, and you need credentials that aren't tied to your GitHub account. OCI registries solve all three.

## What OCI registries give you

An OCI (Open Container Initiative) registry is the same infrastructure that stores your Docker images. Docker Hub, GitHub Container Registry (ghcr.io), AWS ECR, Google Artifact Registry, Azure ACR, Harbor, and self-hosted distribution servers all speak the OCI protocol.

Since Helm 3.8, you can push and pull Helm charts to any OCI-compliant registry. As of 3.14 (the current release as I write this), this is a stable, first-class feature. Not experimental, not opt-in. It's the recommended way to distribute charts.

The mental model is simple: charts become OCI artifacts, stored alongside your container images, with the same access controls and the same tooling.

## Pushing a chart to an OCI registry

First, build your chart package:

```bash
helm package ./my-chart
# produces my-chart-0.1.0.tgz
```

Then authenticate and push:

```bash
# Login (example with GitHub Container Registry)
helm registry login ghcr.io -u myusername -p $GITHUB_TOKEN

# Push the chart
helm push my-chart-0.1.0.tgz oci://ghcr.io/myorg/charts
```

That's it. Your chart is now at `oci://ghcr.io/myorg/charts/my-chart` with version `0.1.0`.

Pulling it back:

```bash
helm pull oci://ghcr.io/myorg/charts/my-chart --version 0.1.0
```

Or installing directly:

```bash
helm install my-release oci://ghcr.io/myorg/charts/my-chart --version 0.1.0
```

No `helm repo add` needed. The OCI URL is the full address.

## Compared to ChartMuseum

Before OCI support matured, ChartMuseum was the standard for self-hosted Helm repositories. It's a simple Go server that serves chart packages over HTTP, implementing the Helm repository protocol.

ChartMuseum works fine. I've run it in production. But it's another service to maintain, with its own database (or filesystem), its own backup strategy, and its own access control layer that doesn't integrate with your existing container registry.

```yaml
# Typical ChartMuseum deployment
helm repo add chartmuseum https://charts.example.com
helm repo update
helm install my-release chartmuseum/my-chart --version 0.1.0
```

With OCI, you skip the `helm repo add` and `repo update` dance. The registry already knows about all your charts because they're stored as artifacts, not as an index file served over HTTP.

The other advantage: your charts live next to your images. If you're building `my-app:1.2.3` and pushing it to `ghcr.io/myorg`, your Helm chart for deploying that image can live at `ghcr.io/myorg/charts/my-app:1.2.3`. Same registry, same authentication, same audit trail.

## Setting up OCI in CI/CD

Here's a GitHub Actions workflow that packages and pushes a chart on every release:

```yaml
name: Publish Helm Chart
on:
  push:
    tags:
      - 'chart-v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4

      - name: Log in to GHCR
        run: helm registry login ghcr.io -u ${{ github.actor }} -p ${{ secrets.GITHUB_TOKEN }}

      - name: Package chart
        run: helm package ./chart

      - name: Push chart
        run: |
          CHART=$(ls *.tgz)
          helm push "$CHART" oci://ghcr.io/${{ github.repository_owner }}/charts
```

For AWS ECR, you need to create the repository first (ECR doesn't auto-create OCI artifact repositories like GHCR does):

```bash
aws ecr create-repository --repository-name charts/my-chart --region ap-southeast-1
```

Then authenticate and push the same way:

```bash
aws ecr get-login-password --region ap-southeast-1 | \
  helm registry login --username AWS --password-stdin 123456789.dkr.ecr.ap-southeast-1.amazonaws.com

helm push my-chart-0.1.0.tgz oci://123456789.dkr.ecr.ap-southeast-1.amazonaws.com/charts
```

## What about the public Artifact Hub?

Artifact Hub (artifacthub.io) indexes Helm charts from various sources, including OCI registries. If you want your chart to be discoverable publicly, register it on Artifact Hub and point it at your OCI registry.

This is better than hosting on a traditional Helm repo because you get the visibility of Artifact Hub while keeping your actual artifacts in your own registry. Artifact Hub just indexes metadata, it doesn't host the chart.

## Chart signing with OCI

One thing OCI registries make easier: provenance and signing. Since charts are OCI artifacts, you can use tools like Cosign (from the Sigstore project) to sign them:

```bash
cosign sign --key cosign.key ghcr.io/myorg/charts/my-chart:0.1.0
```

Verifying:

```bash
cosign verify --key cosign.pub ghcr.io/myorg/charts/my-chart:0.1.0
```

This gives you supply chain verification for your Helm charts, which matters more every day. Traditional Helm repositories have no built-in signing mechanism (Helm has a `--verify` flag for PGP signatures, but almost nobody uses it).

## When you might still want a traditional repo

There are a few cases where a classic `helm repo add` setup makes sense:

- You're distributing charts to users who are on older Helm versions (pre-3.8). This is increasingly rare in 2024.
- You have a very simple setup with a single static web server and no container registry. A traditional repo is just an HTTP server with an `index.yaml` file.
- Your organization has existing tooling built around `helm repo` commands.

But for anything new, start with OCI. The ecosystem has moved there, the tooling is mature, and you'll avoid migrating later.

## The practical migration

If you're currently using ChartMuseum or a traditional repo:

1. Pick an OCI registry (your existing container registry is the obvious choice)
2. Repackage existing charts: `helm package ./chart && helm push chart-*.tgz oci://your-registry/charts`
3. Update CI/CD pipelines to push to OCI
4. Update any ArgoCD or Flux configurations to pull from `oci://` URLs
5. Once everything's migrated, decommission the old repo

ArgoCD supports OCI registries natively. Flux does too. There's no reason to maintain a separate Helm repo server if your GitOps tooling already speaks OCI.

I migrated our charts from ChartMuseum to GitHub Container Registry over a weekend. The hardest part was updating the ArgoCD application manifests, which took about 20 minutes. The rest was just `helm push` commands.

Do it now, while your chart count is manageable. Future you will appreciate it.
