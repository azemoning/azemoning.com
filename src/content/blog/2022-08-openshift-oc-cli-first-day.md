---
title: "Day One with OpenShift: oc is Not kubectl (But Also Kind of Is)"
slug: "openshift-oc-cli-first-day"
date: 2022-08-15
category: "OpenShift"
tags: ["openshift", "kubernetes", "cli", "onboarding", "oc"]
readingTime: "8 min read"
excerpt: "I joined a new project and the onboarding doc said: install oc. Here's what I learned switching from kubectl to OpenShift's CLI."
---

Day one at a new job. The onboarding doc says: install `oc`.

Not `kubectl`. Not `minikube`. Not `kind`. Just `oc`. I'd been working with Kubernetes for a couple of years at that point, so I figured this would be a short afternoon. Download the binary, run a few commands, done. The platform team had other ideas.

<!-- truncate -->

## What even is oc?

If you come from vanilla Kubernetes, you know `kubectl`. It's the standard CLI for talking to the API server. `oc` is Red Hat's CLI for OpenShift, and here's the thing most people don't realize at first: `oc` is a superset of `kubectl`.

Every `kubectl` command works with `oc`. `oc get pods`, `oc apply -f manifest.yaml`, `oc describe node worker-01`... all of it. But `oc` adds a bunch of OpenShift-specific commands on top. And you need those, because OpenShift is not just Kubernetes with a fancy wrapper. It has its own APIs, its own resources, and its own way of doing things.

```bash
# These all work identically
kubectl get pods -n myapp
oc get pods -n myapp

# But this is oc-only
oc new-project myapp
oc new-app https://github.com/myorg/myapp
oc rsh my-pod-name
```

That first week, I kept reaching for `kubectl` out of habit. It worked. But my team lead noticed and said: "Just use `oc`. You'll need it."

He was right.

## Commands you won't find in kubectl

The first `oc`-only command I used in production was `oc rsh`. It's like `kubectl exec` but drops you into a shell directly. No need to specify `/bin/bash` or `/bin/sh`:

```bash
# kubectl way
kubectl exec -it my-pod -n myapp -- /bin/bash

# oc way
oc rsh my-pod
```

Same result, less typing. Small thing, but when you're debugging a production issue at 1 AM, fewer keystrokes matter.

Then there's `oc debug`. This one is genuinely useful. It creates a copy of a pod with debugging tools attached. You can even debug a node directly:

```bash
# Debug a running pod (copies it, adds debug tools)
oc debug pod/my-pod

# Debug a node (SSH-like access)
oc debug node/worker-01
```

On vanilla Kubernetes, you'd have to create a debug pod manually with `kubectl run`, mount the right volumes, use the right node selector... `oc debug` just handles it.

## Project vs Namespace

This one confused me for a week. In OpenShift, you don't create namespaces. You create projects.

```bash
# Kubernetes
kubectl create namespace myapp

# OpenShift
oc new-project myapp
```

A project in OpenShift *is* a namespace under the hood, but with extra metadata. It has a description, a display name, and an admin who created it. The RBAC model also defaults to project-scoped roles. When you create a project, you automatically get `admin` role on it:

```bash
oc new-project myapp
oc whoami --show-context
# You'll see you have admin access in this project
```

In vanilla Kubernetes, creating a namespace gives you... a namespace. You still need to bind roles separately.

## oc adm: the admin toolbox

The `oc adm` subcommand is where the platform team lives. It handles cluster-level admin tasks:

```bash
# Drain a node for maintenance
oc adm drain worker-01 --ignore-daemonsets --delete-emptydir-data

# Manage cluster roles
oc adm policy add-cluster-role-to-user cluster-admin alice

# Check cluster status (useful after upgrades)
oc adm top images
```

I didn't touch `oc adm` for the first month. My team lead handled cluster operations. But once I started helping with node maintenance, it became a regular tool.

## The login and context dance

OpenShift uses OAuth for authentication. When you first connect to a cluster, you get a token through the web console or through `oc login`:

```bash
# Login with username/password
oc login https://api.cluster.example.com:6443 -u alice -p mypassword

# Login with a token
oc login --token=sha256~xxxxx --server=https://api.cluster.example.com:6443

# Check who you are
oc whoami

# Switch projects (like switching namespaces)
oc project production
```

In that project, we used LDAP integration, so `oc login` opens a browser for SSO. The first time I ran it from a terminal without a browser (over SSH), I spent 20 minutes figuring out how to paste the token. (Use `oc login --token=...` with the token from the web console's "Copy login command" feature.)

## What I wish someone told me on day one

A few things that would have saved me time:

1. **`oc` and `kubectl` share the same kubeconfig.** Same `~/.kube/config` file, same contexts. If you set up one, the other works.

2. **Tab completion matters.** Install it early. `oc completion bash >> ~/.bashrc` (or zsh equivalent). The `oc` command has a lot of subcommands, and completion helps you discover them.

3. **The web console is actually useful.** I'm a terminal person, but the OpenShift console shows things that are hard to see from the CLI, like the developer topology view and build logs. Don't ignore it out of principle.

4. **`oc` version matters.** Match your `oc` version to the cluster version. Running `oc` 4.8 against a 4.10 cluster mostly works, but you'll hit weird edge cases with newer API resources.

```bash
# Check your oc version
oc version --client

# Check the cluster version
oc get clusterversion
```

## Three months in

By month three, I'd stopped thinking about the difference. `oc` was just my CLI. I used `kubectl` when writing generic scripts or documentation (since not everyone has `oc`), but for daily work on our OpenShift clusters, it was `oc` all the way.

The hardest part wasn't learning new commands. It was unlearning the assumption that OpenShift is "just Kubernetes." It's Kubernetes underneath, running 1.24 in our case (OCP 4.10), but the platform layer on top changes how you interact with the cluster. `oc` is the interface to that platform layer.

If you're making the same switch I did, start with `oc new-project` and `oc rsh`. You'll pick up the rest as you go. And when you get stuck, `oc --help` is genuinely well-written. Not something I say about most CLIs.