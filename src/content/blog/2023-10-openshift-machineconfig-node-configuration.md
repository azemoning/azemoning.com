---
title: "Changing Kernel Parameters on OpenShift Nodes: The MachineConfig Way"
slug: "openshift-machineconfig-node-configuration"
date: 2023-10-19
category: "OpenShift"
tags: ["openshift", "machineconfig", "nodes", "infrastructure", "butane"]
readingTime: "9 min read"
excerpt: "You need to change a kernel parameter on all your worker nodes. How? OpenShift's MachineConfig is the answer."
---

You need to change a kernel parameter on all your worker nodes. `net.ipv4.ip_forward=1`, maybe. Or increase the `fs.inotify.max_user_watches` limit because your application is watching too many files. Or load a custom kernel module.

How?

On a traditional Linux server, you SSH in, edit `/etc/sysctl.conf`, run `sysctl -p`, and you're done. But you can't SSH into OpenShift nodes (well, you shouldn't). They're managed by the platform. You're not supposed to touch them directly.

This is where MachineConfig comes in.

<!-- truncate -->

## What is a MachineConfig?

A MachineConfig is an OpenShift resource that declares what a set of nodes should look like. Files, systemd units, kernel arguments, and more. The API lives under `machineconfiguration.openshift.io/v1`.

```bash
# List existing machine configs
oc get mc

# Check machine config pools (groups of nodes)
oc get mcp
```

```
NAME     CONFIG                                             UPDATED   UPDATING   DEGRADED   MACHINECOUNT   READYMACHINECOUNT   UPDATEDMACHINECOUNT   DEGRADEDMACHINECOUNT   AGE
master   rendered-master-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6   True      False      False      3              3                   3                     0                      45d
worker   rendered-worker-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6   True      False      False      6              6                   6                     0                      45d
```

Machine Config Pools (MCPs) group nodes together. By default, you have `master` and `worker`. You can create custom pools for specialized nodes (GPU workers, high-memory nodes, etc.).

## Changing a kernel parameter

Let's say you need to increase `fs.inotify.max_user_watches`. Here's the MachineConfig:

```yaml
apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfig
metadata:
  labels:
    machineconfiguration.openshift.io/role: worker
  name: 99-worker-inotify-tuning
spec:
  config:
    ignition:
      version: 3.2.0
    storage:
      files:
      - path: /etc/sysctl.d/99-inotify.conf
        mode: 0644
        contents:
          source: data:,fs.inotify.max_user_watches%3D524288%0Afs.inotify.max_user_instances%3D1024%0A
```

A few things to notice:

1. **The label** `machineconfiguration.openshift.io/role: worker` targets worker nodes. Use `master` for control plane nodes.
2. **The name** starts with `99-`. Machine configs are applied in alphabetical order. Names starting with higher numbers override lower ones. The convention is `XX-<role>-<description>`.
3. **Ignition** is the config format. OpenShift uses Ignition (originally from CoreOS) to configure nodes at boot.
4. **The file contents** are a data URL. The `%3D` and `%0A` are URL-encoded `=` and newlines.

When you apply this MachineConfig, the Machine Config Operator (MCO) will:

1. Mark the worker MCP as "Updating"
2. Drain one node at a time
3. Apply the new configuration
4. Reboot the node
5. Wait for the node to come back
6. Move to the next node

This is a rolling update. Your workloads keep running on the other nodes while each one reboots.

## Butane: a friendlier format

Writing Ignition configs by hand is painful. The URL-encoded data URIs are unreadable. Enter **Butane** (formerly called FCC, Fedora CoreOS Config).

Butane is a YAML-based format that gets compiled into Ignition configs. Install it:

```bash
# Download butane
curl -LO https://github.com/coreos/butane/releases/download/v0.19.0/butane-x86_64-unknown-linux-gnu
chmod +x butane-x86_64-unknown-linux-gnu
mv butane-x86_64-unknown-linux-gnu /usr/local/bin/butane
```

Write your config in Butane format:

```yaml
# 99-worker-inotify-tuning.bu
variant: openshift
version: 4.14.0
metadata:
  labels:
    machineconfiguration.openshift.io/role: worker
  name: 99-worker-inotify-tuning
storage:
  files:
  - path: /etc/sysctl.d/99-inotify.conf
    mode: 0644
    contents:
      inline: |
        fs.inotify.max_user_watches=524288
        fs.inotify.max_user_instances=1024
```

Then compile it:

```bash
butane -d . 99-worker-inotify-tuning.bu -o 99-worker-inotify-tuning.yaml
```

The output is a valid MachineConfig YAML with properly encoded Ignition content. Much more readable source.

## More useful MachineConfigs

**Loading a kernel module:**

```yaml
variant: openshift
version: 4.14.0
metadata:
  labels:
    machineconfiguration.openshift.io/role: worker
  name: 99-worker-load-br-netfilter
storage:
  files:
  - path: /etc/modules-load.d/br-netfilter.conf
    mode: 0644
    contents:
      inline: |
        br-netfilter
```

**Adding a custom CA certificate:**

```yaml
variant: openshift
version: 4.14.0
metadata:
  labels:
    machineconfiguration.openshift.io/role: worker
  name: 99-worker-custom-ca
storage:
  files:
  - path: /etc/pki/ca-trust/source/anchors/internal-ca.crt
    mode: 0644
    contents:
      local: internal-ca.crt
```

(With `-d .` flag, Butane reads `internal-ca.crt` from the current directory and embeds it.)

**Setting a custom container runtime config (cgroup v2, for example):**

```yaml
apiVersion: machineconfiguration.openshift.io/v1
kind: ContainerRuntimeConfig
metadata:
  name: enable-cgroupsv2
spec:
  machineConfigPoolSelector:
    matchLabels:
      pools.operator.machineconfiguration.openshift.io/worker: ""
  containerRuntimeConfig:
    logLevel: debug
```

## The drain and reboot cycle

When you apply a MachineConfig, nodes drain and reboot. This is disruptive. Plan for it.

The MCO respects PodDisruptionBudgets. If a PDB says "at least 2 replicas must be available," the MCO won't drain a node if it would violate that. This is why PDBs matter beyond just `kubectl drain`.

Control how many nodes update at once with `maxUnavailable` on the MachineConfigPool:

```yaml
apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfigPool
metadata:
  name: worker
spec:
  maxUnavailable: 2
  machineConfigSelector:
    matchLabels:
      pools.operator.machineconfiguration.openshift.io/worker: ""
  nodeSelector:
    matchLabels:
      node-role.kubernetes.io/worker: ""
```

By default, `maxUnavailable` is 1. Setting it to 2 means two nodes will drain and reboot simultaneously. Faster updates, but more capacity loss at once.

## Checking the status

```bash
# Overall pool status
oc get mcp

# Detailed status of a specific pool
oc describe mcp worker

# Check which MachineConfig a node is using
oc get node worker-01 -o jsonpath='{.metadata.machineconfiguration\.openshift\.io/currentConfig}'

# See if an update is in progress
oc get mcp worker -o jsonpath='{.status.conditions[?(@.type=="Updating")].status}'
```

A healthy update cycle looks like: `UPDATING=True` then `UPDATING=False` with `DEGRADED=False`. If `DEGRADED=True`, something went wrong. Check the MCO logs:

```bash
oc logs -n openshift-machine-config-operator deployment/machine-config-operator
```

## What goes wrong

**Don't name your MachineConfig after an existing one.** If you create a file that overrides a system-managed file, you'll break things. Use high-numbered prefixes (99-) and descriptive names.

**MachineConfigs are immutable for a node.** You can't edit a MachineConfig and have nodes pick up the change. You create a new MachineConfig with different content. The MCO applies the combined state of all matching MachineConfigs.

**The reboot is real.** Nodes actually reboot. This takes 5-10 minutes per node. On a 6-node worker pool with `maxUnavailable: 1`, that's 30-60 minutes for the full rollout. Schedule this during maintenance windows.

**Custom MachineConfigPools need careful labeling.** If you create a custom pool (like a GPU pool), make sure nodes can only belong to one pool. Overlapping pools cause unpredictable behavior.

## The broader picture

MachineConfig is OpenShift's answer to "how do I manage nodes as code?" It's the same philosophy as Terraform or Ansible, but integrated into the Kubernetes API. You declare what nodes should look like, and the operator makes it happen.

In my current project, we use MachineConfigs for everything from sysctl tuning to custom CA certificates to container runtime configuration. The beauty is that it's declarative. The node state lives in Git as MachineConfig YAMLs. If someone manually changes a node file, the MCO reverts it on the next sync.

It's not perfect. The reboot cycle is slow, and you can't do hot-reload of kernel parameters (the node must reboot for most changes). But it's reliable, it's auditable, and it keeps our nodes consistent. For a regulated environment, that matters.