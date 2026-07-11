---
title: "Where Do Your Images Live? OpenShift's Internal Registry and ImageStreams"
slug: "openshift-imagestream-internal-registry"
date: 2024-04-03
category: "OpenShift"
tags: ["openshift", "imagestream", "registry", "containers", "docker"]
readingTime: "8 min read"
excerpt: "Your images don't live in Docker Hub anymore. Where do they go? Inside the cluster, in an internal registry managed by OpenShift."
---

Your images don't live in Docker Hub anymore.

I mean, some of them still do. Your base images (UBI, nginx, postgres) probably come from a public registry. But the images you build, the ones with your application code? On OpenShift, they live inside the cluster. In a registry you didn't set up, managed by an operator you didn't install.

This confused me when I first started working with OpenShift. On my previous Kubernetes clusters, I'd push images to Docker Hub or a private Harbor instance. The workflow was: build, tag, push, update the Deployment. On OpenShift, the workflow is different, and the reason is ImageStreams.

<!-- truncate -->

## The internal registry

Every OpenShift cluster comes with an internal container image registry. It's deployed in the `openshift-image-registry` namespace:

```bash
oc get pods -n openshift-image-registry
```

```
NAME                                               READY   STATUS    RESTARTS   AGE
cluster-image-registry-operator-6c8f7f8f5d-abc12  1/1     Running   0          30d
image-registry-5c6d7e8f9a-mno90                    1/1     Running   0          30d
```

The registry service is:

```
image-registry.openshift-image-registry.svc:5000
```

That's the internal address. Any pod in the cluster can pull images from it. To push images from outside the cluster (your CI server, your laptop), you need a route:

```bash
# Create a route for the registry (if not already created)
oc patch configs.imageregistry cluster --type merge -p '{"spec":{"defaultRoute":true}}'

# Get the route
oc get route -n openshift-image-registry
```

```
NAME              HOST/PORT                                            PATH   SERVICES          PORT    TERMINATION   WILDCARD
default-route     default-route-openshift-image-registry.apps...              image-registry    <all>   passthrough   None
```

Log in with `docker` or `podman`:

```bash
# Login using oc token
TOKEN=$(oc whoami -t)
podman login -u kubeadmin -p $TOKEN default-route-openshift-image-registry.apps.cluster.example.com

# Or using oc registry login
oc registry login
```

## ImageStreams: what they are

An ImageStream is an OpenShift resource (`image.openshift.io/v1`) that tracks container images. It doesn't store images itself. It's a mapping: "this tag points to this image in this registry."

```yaml
apiVersion: image.openshift.io/v1
kind: ImageStream
metadata:
  name: my-app
  namespace: my-project
spec:
  lookupPolicy:
    local: true
```

When you create an ImageStream, OpenShift creates a namespace in the internal registry:

```
image-registry.openshift-image-registry.svc:5000/my-project/my-app
```

Tags within the ImageStream track specific image digests:

```bash
# List ImageStreams
oc get is -n my-project

# Get detailed tag info
oc describe is my-app
```

```
Name:           my-app
Namespace:      my-project
Created:        2 hours ago
Labels:         <none>
Annotations:    <none>
Image Lookup:   local=true
Unique Images:  2
Tags:           2

latest
  tagged from my-app:sha256-abc123...

  * image-registry.openshift-image-registry.svc:5000/my-project/my-app@sha256:abc123...
    2 hours ago

v1.0
  tagged from my-app:sha256-def456...

  * image-registry.openshift-image-registry.svc:5000/my-project/my-app@sha256:def456...
    1 day ago
```

## Why ImageStreams exist

The key feature: **image resolution**.

When you reference an ImageStream tag in a Deployment, OpenShift resolves it to the actual image digest at deployment time:

```yaml
# This works because lookupPolicy.local: true
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  template:
    spec:
      containers:
      - name: my-app
        image: my-app:latest  # Resolved via ImageStream in the same namespace
```

You don't need the full registry path. OpenShift knows that `my-app:latest` refers to the ImageStream tag in the current namespace. This makes manifests portable across clusters (the image path doesn't hardcode a registry hostname).

The `lookupPolicy.local: true` field on the ImageStream enables this. Without it, the short reference doesn't resolve.

## Managing ImageStreams

**Import an image from an external registry:**

```bash
# Import nginx from Docker Hub
oc import-image nginx:1.25 --from=docker.io/library/nginx:1.25 --confirm

# Import from a private registry
oc import-image my-app:latest --from=harbor.internal.company.com/myteam/my-app:latest --confirm
```

**Tag images:**

```bash
# Tag the current latest as v1.0
oc tag my-app:latest my-app:v1.0

# Tag from one namespace to another
oc tag my-project/my-app:stable prod-project/my-app:latest

# Tag an external image
oc tag docker.io/library/nginx:1.25 my-project/nginx:latest
```

**Watch for updates:**

If you import from an external registry, you can set up scheduled imports:

```yaml
apiVersion: image.openshift.io/v1
kind: ImageStream
metadata:
  name: nginx
spec:
  tags:
  - name: "1.25"
    from:
      kind: DockerImage
      name: docker.io/library/nginx:1.25
    importPolicy:
      scheduled: true  # Re-import every 15 minutes
```

This checks the source registry every 15 minutes. If the tag points to a new digest, the ImageStream updates. Combined with ImageChange triggers on DeploymentConfig (or the equivalent on Deployment), this auto-deploys when the upstream image changes.

## The BuildConfig connection

ImageStreams integrate tightly with BuildConfig (`build.openshift.io/v1`), OpenShift's build system. A BuildConfig takes source code, builds a container image, and pushes it to an ImageStream:

```yaml
apiVersion: build.openshift.io/v1
kind: BuildConfig
metadata:
  name: my-app
  namespace: my-project
spec:
  source:
    type: Git
    git:
      uri: https://github.com/myorg/my-app
  strategy:
    type: Source
    sourceStrategy:
      from:
        kind: ImageStreamTag
        name: ubi9:latest
        namespace: openshift
  output:
    to:
      kind: ImageStreamTag
      name: my-app:latest
```

When this build runs, it:
1. Clones the Git repo
2. Builds a container image using the UBI9 base from the `openshift` namespace
3. Pushes the result to the `my-app` ImageStream with tag `latest`

The full pipeline: BuildConfig builds the image, pushes to ImageStream, ImageStream update triggers a deployment. All within the cluster, no external registry needed.

## Storage considerations

The internal registry needs persistent storage. Without it, images are stored on ephemeral pod storage and lost on restart.

Check the registry's storage configuration:

```bash
oc get config.imageregistry cluster -o jsonpath='{.spec.storage}'
```

For production, configure PVC-based storage:

```yaml
apiVersion: imageregistry.operator.openshift.io/v1
kind: Config
metadata:
  name: cluster
spec:
  storage:
    pvc:
      claim: image-registry-storage
```

In my projects, we typically use Ceph RBD for the registry PVC. On a cluster with a few hundred images, expect 50-200 GB depending on image sizes and retention.

## When to use an external registry instead

The internal registry is convenient but limited:

- **No UI.** If your team wants a registry UI like Harbor's, use an external registry.
- **Scaling.** The internal registry is a single pod (or few replicas). For heavy build workloads, an external registry scales better.
- **Multi-cluster.** If you have multiple OpenShift clusters sharing images, an external registry is simpler than cross-cluster ImageStream imports.
- **Retention policies.** The internal registry has basic garbage collection. External registries (Harbor, Nexus, ECR) have more sophisticated retention policies.

We use the internal registry for development images and the ImageStream integration. Production images go through our CI/CD pipeline to an external registry, then get imported back as ImageStreams for deployment.

## The practical workflow

Here's what developers typically do:

1. Write code, push to Git
2. BuildConfig (or Tekton pipeline) builds the image, pushes to internal registry as an ImageStream
3. ImageStream updates, triggering a deployment (via DeploymentConfig or CI/CD)
4. Developer verifies in the dev project
5. Promote to staging/production by tagging: `oc tag my-project/my-app:latest staging-project/my-app:latest`

The `oc tag` command is the promotion mechanism. No image copying, no registry switching. Just a pointer update in the ImageStream.

It's a different workflow than what most Kubernetes users are used to. But once you get the hang of it, the integration between builds, image tracking, and deployments is pretty smooth. The internal registry and ImageStreams are one of those OpenShift features that seems unnecessary until you use them for a few months and realize you don't want to go back.