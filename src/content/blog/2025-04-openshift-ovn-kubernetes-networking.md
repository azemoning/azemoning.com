---
title: "OpenShift Switched to OVN-Kubernetes. Here's What Changed."
slug: "openshift-ovn-kubernetes-networking"
date: 2025-04-17
category: "OpenShift"
tags: ["openshift", "networking", "ovn-kubernetes", "egressip", "networkpolicy"]
readingTime: "9 min read"
excerpt: "OpenShift switched from OpenShift SDN to OVN-Kubernetes. Here's what changed and what you need to know."
---

OpenShift SDN was the default network plugin from OpenShift 3.x through 4.13. If you've been running OpenShift for a while, you've used it. If you've been debugging networking issues on OpenShift, you've cursed at it.

Starting with OCP 4.18, the default is OVN-Kubernetes. It's a different CNI with different internals, different features, and different troubleshooting tools. In a previous project, we migrated from OpenShift SDN to OVN-Kubernetes. Here's what I learned.

<!-- truncate -->

## Why the switch?

OpenShift SDN was built on Open vSwitch (OVS) with a custom controller. It worked, but it had limitations:

- **No native EgressIP support.** OpenShift SDN had a basic EgressIP implementation, but it was flaky and limited.
- **Limited NetworkPolicy performance.** On clusters with many policies, OpenShift SDN struggled.
- **Single-tenant or multi-tenant modes.** These were separate configurations with different isolation models. Confusing and limiting.
- **Upstream disconnect.** OpenShift SDN was Red Hat-specific. It wasn't maintained by the broader Kubernetes community.

OVN-Kubernetes is based on Open Virtual Network (OVN), a mature networking project from the Open vSwitch community. It's the CNI used by default in OCP 4.18+.

## What's the same

Before getting into differences, let's cover what doesn't change for most users:

- **Pod-to-pod networking** works the same way. Pods get IP addresses, can talk to each other across nodes.
- **Services** (ClusterIP, NodePort, LoadBalancer) work the same way. kube-proxy (or its replacement) handles service routing.
- **Routes** still work. The HAProxy router is the same, regardless of the underlying CNI.
- **NetworkPolicy** works the same way. The API (`networking.k8s.io/v1`) is identical. You write the same YAML.

For most application developers, the migration from OpenShift SDN to OVN-Kubernetes is transparent. You won't notice the difference.

## What's different

### Network internals

OpenShift SDN used a VXLAN overlay between nodes. All pod traffic was encapsulated in VXLAN packets.

OVN-Kubernetes uses Geneve (Generic Network Virtualization Encapsulation) by default. Geneve is similar to VXLAN but more extensible. From a practical standpoint, the overhead is similar. But if you were debugging packet captures with VXAN filters, you need to switch to Geneve:

```bash
# OpenShift SDN: VXLAN on port 4789
tcpdump -i eth0 port 4789

# OVN-Kubernetes: Geneve on port 6081
tcpdump -i eth0 port 6081
```

### EgressIP: now it actually works

EgressIP assigns a specific source IP address to pod traffic leaving the cluster. This is useful for firewalls that whitelist specific source IPs.

```yaml
apiVersion: k8s.ovn.org/v1
kind: EgressIP
metadata:
  name: my-egress-ip
spec:
  egressIPs:
  - 10.0.1.100
  - 10.0.1.101  # Failover IP on a different node
  namespaceSelector:
    matchLabels:
      egress-group: production
```

With OpenShift SDN, EgressIP was unreliable. Failover was slow. Sometimes it just didn't apply.

With OVN-Kubernetes, it works reliably. The `k8s.ovn.org/v1` API is native to OVN, not a bolted-on feature. Failover happens in seconds.

```bash
# Check EgressIP status
oc get egressip
```

```
NAME            EGRESSIPS       ASSIGNED NODE   ASSIGNED EGRESSIPS
my-egress-ip    10.0.1.100      worker-02       10.0.1.100
```

In my projects, we use EgressIP for any pod that talks to external systems with IP-based firewall rules. It was one of the main reasons we pushed for the OVN-Kubernetes migration.

### Egress firewall

OVN-Kubernetes supports egress firewall (also called egress network policies). This controls what external addresses pods can reach:

```yaml
apiVersion: k8s.ovn.org/v1
kind: EgressFirewall
metadata:
  name: restrict-egress
  namespace: my-project
spec:
  egress:
  - type: Allow
    to:
      cidrSelector: 10.0.0.0/8
  - type: Allow
    to:
      dnsName: api.external-service.com
  - type: Deny
    to:
      cidrSelector: 0.0.0.0/0
```

This says: allow traffic to the internal 10.0.0.0/8 range and to `api.external-service.com`, deny everything else.

Egress firewall rules are processed in order. The first match wins. The final deny-all is implicit if you have any rules at all.

OpenShift SDN had this too, but OVN-Kubernetes handles DNS-based rules more reliably. The DNS resolution happens at connection time, not at rule creation time.

### Multicast

OVN-Kubernetes supports multicast between pods. This is niche but useful for specific workloads (financial data distribution, for example):

```yaml
# Enable multicast in a namespace
apiVersion: k8s.ovn.org/v1
kind: Multicast
metadata:
  name: default
  namespace: my-project
spec:
  multicast:
    enabled: true
```

Once enabled, pods in the namespace can send and receive multicast traffic. OpenShift SDN didn't support this.

## Troubleshooting differences

The debugging tools changed. If you're used to OpenShift SDN's tools, here's the mapping:

**OpenShift SDN debugging:**
```bash
# These no longer work with OVN-Kubernetes
oc get netnamespaces
oc get hostsubnets
oc get clusternetworks
```

**OVN-Kubernetes debugging:**
```bash
# Check OVN-Kubernetes pods
oc get pods -n openshift-ovn-kubernetes

# Check OVN databases
oc rsh -n openshift-ovn-kubernetes ovnkube-node-xxxxx ovn-nbctl show
oc rsh -n openshift-ovn-kubernetes ovnkube-node-xxxxx ovn-sbctl show

# Check network policy enforcement
oc rsh -n openshift-ovn-kubernetes ovnkube-node-xxxxx ovn-nbctl acl-list

# Check pod networking
oc rsh -n openshift-ovn-kubernetes ovnkube-node-xxxxx ovn-nbctl lsp-list
```

The `ovn-nbctl` and `ovn-sbctl` commands are the primary debugging tools. They query the OVN northbound and southbound databases directly.

For a more user-friendly view, use the `oc` debug command on an OVN node:

```bash
# Get on a node and inspect OVN
oc debug node/worker-01
chroot /host
ovn-nbctl show
ovn-nbctl lr-route-list ovn-cluster-router
```

## NetworkPolicy: no changes needed

NetworkPolicy (`networking.k8s.io/v1`) works the same on both CNI plugins. Your existing policies carry over without changes:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-from-ingress
  namespace: my-project
spec:
  podSelector:
    matchLabels:
      app: my-app
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          network.openshift.io/policy-group: ingress
```

One thing to note: in OVN-Kubernetes, NetworkPolicy enforcement is more consistent. With OpenShift SDN, there were edge cases where policies were evaluated differently depending on the mode (single-tenant vs multi-tenant). OVN-Kubernetes always enforces policies the same way.

## Migration from OpenShift SDN

The migration from OpenShift SDN to OVN-Kubernetes is a cluster-level operation. You can't do it per-namespace. The entire cluster switches at once.

The process involves:
1. Validate your workloads aren't using SDN-specific features (the deprecated `netnamespace` or `hostsubnet` resources)
2. Schedule a maintenance window
3. Run the network migration procedure (Red Hat provides a documented process)
4. Nodes reboot with the new CNI
5. Verify networking works

The actual migration took about 45 minutes on our cluster (3 masters, 6 workers). The scariest part was the brief network disruption during the cutover. Pods kept running, but active connections dropped for a few seconds.

If you're still on OpenShift SDN, start planning the migration now. OpenShift SDN is deprecated and will be removed in a future release. OVN-Kubernetes is the path forward.