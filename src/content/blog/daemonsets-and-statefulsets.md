---
title: "DaemonSets and StatefulSets: When Deployments Aren't Enough"
slug: "daemonsets-and-statefulsets"
date: 2021-03-18
category: "Kubernetes"
tags: ["kubernetes", "daemonset", "statefulset", "workloads"]
readingTime: "9 min read"
excerpt: "You need exactly one pod on every node. Deployment can't do that. Here's what can."
---

You need exactly one pod on every node. Deployment can't do that.

This realization usually hits when you're building a logging agent, a metrics collector, or a network plugin. You don't want three replicas spread however the scheduler feels like it. You want one instance per node, no more, no less. If a new node joins the cluster, the pod should appear there automatically. If a node leaves, the pod should be cleaned up.

That's a DaemonSet. And once you understand DaemonSets, the natural follow-up question is "what about workloads that need stable identity and ordered deployment?" That's a StatefulSet.

Two workload types that fill gaps Deployment leaves open. I use both regularly and I've made enough mistakes with each to share what actually matters.

<!-- truncate -->

## DaemonSet: one pod per node

A DaemonSet ensures that a copy of a pod runs on every node (or a subset of nodes). The API is familiar if you've used Deployments:

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: log-collector
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: log-collector
  template:
    metadata:
      labels:
        app: log-collector
    spec:
      containers:
        - name: fluentd
          image: fluentd:v1.16
          resources:
            limits:
              memory: "200Mi"
              cpu: "200m"
          volumeMounts:
            - name: varlog
              mountPath: /var/log
            - name: containers
              mountPath: /var/lib/docker/containers
              readOnly: true
      volumes:
        - name: varlog
          hostPath:
            path: /var/log
        - name: containers
          hostPath:
            path: /var/lib/docker/containers
```

Apply this to a 5-node cluster and you get 5 pods. Add a 6th node and a 6th pod appears automatically. Remove a node and its pod goes away. No replica count to manage, no scaling policy to configure.

## DaemonSet update strategies

DaemonSets support two update strategies:

**RollingUpdate** (default): Pods are updated one at a time. When you change the pod template, the DaemonSet controller replaces pods sequentially. There's a `maxUnavailable` setting that controls how many pods can be down during the update:

```yaml
spec:
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
```

**OnDelete:** Pods are only updated when you manually delete them. The DaemonSet controller creates a new pod to replace the deleted one with the updated spec. This gives you manual control over when each node updates.

I use RollingUpdate for most DaemonSets. OnDelete is useful when the DaemonSet runs something sensitive (like a CNI plugin) where you want to update one node at a time and verify it works before moving on.

## Node selection

You don't always want a DaemonSet on every node. Maybe you only want the log collector on worker nodes, not on control plane nodes. Use `nodeSelector` or `affinity`:

```yaml
spec:
  template:
    spec:
      nodeSelector:
        node-role.kubernetes.io/worker: ""
```

Or use tolerations to run on tainted nodes:

```yaml
spec:
  template:
    spec:
      tolerations:
        - key: node-role.kubernetes.io/control-plane
          operator: Exists
          effect: NoSchedule
```

The combination of nodeSelector and tolerations gives you precise control over which nodes get the DaemonSet pod. I've seen people add tolerations for every possible taint and then wonder why their DaemonSet is running on nodes where it shouldn't be.

## What DaemonSets are actually for

Real workloads I run as DaemonSets:

**Log collection.** Fluentd or Filebeat on every node, tailing container logs from `/var/log/containers/`. You need one per node because each node has its own log directory.

**Node metrics.** Prometheus node_exporter exposing hardware and OS metrics. One per node, binding to the host network.

**Network plugins.** Calico, Cilium, or Flannel agents. The pod network doesn't work without these running on every node.

**Storage agents.** Ceph or GlusterFS node agents that manage local storage.

The pattern is always the same: something that needs to interact with node-level resources (host filesystem, host network, host devices) and needs exactly one instance per node.

## StatefulSets: ordered, stable identity

Now for the other gap. Deployments give you pods with random names (`web-app-7d4b8c6f9-x2kj4`). When that pod is rescheduled, it gets a new name, a new hostname, and potentially a new persistent volume. For stateless web apps, this is fine. For a database cluster, it's a disaster.

StatefulSets solve this with three guarantees:

**Stable network identity.** Pods get predictable names: `mysql-0`, `mysql-1`, `mysql-2`. When `mysql-1` is rescheduled, it comes back as `mysql-1` with the same hostname.

**Stable persistent storage.** Each pod gets its own PVC that follows it across reschedules. `mysql-1` always mounts `data-mysql-1`.

**Ordered deployment and scaling.** Pods are created sequentially: `mysql-0` must be Running and Ready before `mysql-1` starts. Same for deletion, in reverse order.

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mysql
spec:
  serviceName: mysql
  replicas: 3
  selector:
    matchLabels:
      app: mysql
  template:
    metadata:
      labels:
        app: mysql
    spec:
      containers:
        - name: mysql
          image: mysql:8.0
          ports:
            - containerPort: 3306
          env:
            - name: MYSQL_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: mysql-secret
                  key: password
          volumeMounts:
            - name: data
              mountPath: /var/lib/mysql
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes:
          - ReadWriteOnce
        storageClassName: fast-ssd
        resources:
          requests:
            storage: 20Gi
```

The `volumeClaimTemplates` section is key. It tells the StatefulSet controller to create a PVC for each pod. `mysql-0` gets `data-mysql-0`, `mysql-1` gets `data-mysql-1`, and so on. These PVCs are not deleted when the StatefulSet is deleted (this is important and I'll come back to it).

## The headless service

StatefulSets need a headless Service for network identity. A headless Service has `clusterIP: None`, which means DNS returns individual pod IPs instead of a single service IP.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mysql
spec:
  clusterIP: None
  selector:
    app: mysql
  ports:
    - port: 3306
```

With this in place, pods can reach each other by DNS name:

- `mysql-0.mysql.default.svc.cluster.local`
- `mysql-1.mysql.default.svc.cluster.local`
- `mysql-2.mysql.default.svc.cluster.local`

This is how database clusters do peer discovery. Each node knows its own identity and can find the others by name. No external discovery service needed.

## Ordered operations

The StatefulSet controller creates pods in order. For a 3-replica MySQL StatefulSet:

1. `mysql-0` is created and must become Ready
2. `mysql-1` is created and must become Ready
3. `mysql-2` is created and must become Ready

Deletion happens in reverse:

1. `mysql-2` is deleted
2. `mysql-1` is deleted
3. `mysql-0` is deleted

This ordering matters for databases. The first pod is typically the primary. The subsequent pods initialize by connecting to the primary. If you scale down, the last replica (a secondary) is removed first, preserving the primary.

Updates follow the same pattern. If you change the pod template, `mysql-2` is updated first, then `mysql-1`, then `mysql-0`. You can control this with `partition`:

```yaml
spec:
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      partition: 2
```

With `partition: 2`, only pods with an ordinal index >= 2 are updated. In this case, only `mysql-2`. This is a manual canary: update one replica, verify it works, then lower the partition to roll out to the rest.

## The PVC deletion gotcha

When you delete a StatefulSet, the PVCs are *not* automatically deleted. This is by design: you don't want to lose data just because someone deleted the StatefulSet object. But it catches people off guard.

If you delete the StatefulSet and recreate it (maybe with a different image), the new pods bind to the existing PVCs. That's usually what you want. But if you delete the StatefulSet *and* the PVCs, the data is gone.

```bash
# Delete the StatefulSet
kubectl delete statefulset mysql

# PVCs are still there
kubectl get pvc -l app=mysql
# NAME          STATUS   VOLUME   CAPACITY   ACCESS MODES
# data-mysql-0  Bound    ...      20Gi       RWO
# data-mysql-1  Bound    ...      20Gi       RWO
# data-mysql-2  Bound    ...      20Gi       RWO

# To also delete PVCs (careful!)
kubectl delete pvc -l app=mysql
```

I've seen teams confused by "stale" PVCs after deleting a StatefulSet. The PVCs aren't stale. They're your data. Treat them accordingly.

## When to use which

The decision tree is straightforward:

**Deployment:** Stateless replicas. Any replica can serve any request. Scaling is adding or removing replicas. Order doesn't matter.

**DaemonSet:** Node-level agents. Exactly one per node. Uses host resources (filesystem, network, devices). Scaling is automatic with cluster size.

**StatefulSet:** Stateful workloads that need stable identity. Databases, message queues, distributed caches. Order matters. Each instance has its own data.

I've seen people try to use Deployments for databases (no stable identity, PVCs get tangled) and DaemonSets for application workloads (no control over replica count). Neither ends well.



Deployments cover the 80% case. DaemonSets and StatefulSets cover the 20% that gets interesting. DaemonSets are conceptually simple (one per node, that's it), but the node selection and host access patterns take some practice. StatefulSets are more complex because they manage identity, storage, and ordering simultaneously.

Start with Deployments. When you hit a workload where stable names or per-node placement matters, reach for StatefulSets or DaemonSets. And read the volume claim documentation twice before deleting anything.