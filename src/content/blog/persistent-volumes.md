---
title: "Persistent Volumes: Keeping Data Alive When Pods Die"
slug: "persistent-volumes"
date: 2020-04-10
category: "Kubernetes"
tags: ["kubernetes", "persistent-volumes", "storage", "storageclass"]
readingTime: "10 min read"
excerpt: "Your pod restarts and all its data is gone. Persistent Volumes fix that, but the setup is more nuanced than the docs suggest."
---

Your pod restarts and all its data is gone.

This is the first thing that surprises people coming from traditional server deployments. On a VM, if your process crashes, the files on disk are still there when it comes back up. In Kubernetes, a container's writable layer is ephemeral. When the container dies, so does everything it wrote.

I learned this the hard way running a PostgreSQL container for a side project. (I know, I know. Don't run databases in containers. I was young and optimistic.) The pod got rescheduled to a different node after a node drain. The database was empty. The backup was three weeks old. I spent a Saturday rebuilding.

PersistentVolumes (PV) and PersistentVolumeClaims (PVC) are Kubernetes' answer to this. They decouple storage from the pod lifecycle so your data survives restarts, rescheduling, and node failures.

<!-- truncate -->

## The concept: two separate objects

Kubernetes splits storage into two objects, and this confuses people initially.

**PersistentVolume (PV)** is the actual storage. Think of it as the disk. It has a capacity, an access mode, a storage class, and a connection to some backing storage system (NFS, cloud disk, iSCSI, whatever).

**PersistentVolumeClaim (PVC)** is the request for storage. It's what a pod uses to say "I need 10Gi of storage with ReadWriteOnce access." The PVC gets bound to a PV that satisfies the request.

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: my-pv
spec:
  capacity:
    storage: 10Gi
  accessModes:
    - ReadWriteOnce
  hostPath:
    path: /mnt/data
```

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
```

The PVC asks for 10Gi with ReadWriteOnce. The PV provides 10Gi with ReadWriteOnce. Kubernetes binds them together. Then a pod references the PVC:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  containers:
    - name: app
      image: nginx:1.25
      volumeMounts:
        - mountPath: /usr/share/nginx/html
          name: web-content
  volumes:
    - name: web-content
      persistentVolumeClaim:
        claimName: my-pvc
```

The container sees the persistent volume mounted at `/usr/share/nginx/html`. Files written there survive pod restarts. When the pod is rescheduled to another node, the volume (if it supports it) follows.

## Access modes matter

PVs have access modes that determine how they can be mounted:

- **ReadWriteOnce (RWO):** One node can read and write. This is the most common for block storage (EBS, GCE PD, etc.).
- **ReadOnlyMany (ROX):** Multiple nodes can read, but nobody writes. Good for shared config or static assets.
- **ReadWriteMany (RWX):** Multiple nodes can read and write simultaneously. NFS and CephFS support this. Block storage usually doesn't.

If you try to mount a ReadWriteOnce PVC from pods on two different nodes, the second pod will hang in `ContainerCreating`. The kubelet can't attach the volume because the first node still has it. I've seen this happen when someone scales a Deployment to 5 replicas and the scheduler spreads them across nodes.

The fix: use a StatefulSet (which keeps pods on the same node or uses ReadWriteMany volumes), or use a storage backend that supports RWX.

## Dynamic provisioning with StorageClass

Creating PVs manually is tedious and doesn't scale. You'd need a cluster admin to provision storage every time a developer needs a PVC. That's where StorageClass comes in.

A StorageClass defines a "class" of storage and the provisioner that creates it:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: kubernetes.io/aws-ebs
parameters:
  type: gp2
  fsType: ext4
reclaimPolicy: Retain
volumeBindingMode: WaitForFirstConsumer
```

With a StorageClass in place, you don't need to create PVs manually. You just reference the class in your PVC:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: app-data
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: fast-ssd
  resources:
    requests:
      storage: 20Gi
```

When this PVC is created, the provisioner associated with `fast-ssd` automatically creates a PV (and the underlying cloud disk) and binds it to the claim. No admin intervention needed.

## Reclaim policies

When you delete a PVC, what happens to the PV? That depends on the reclaim policy.

**Retain:** The PV still exists after the PVC is deleted. An admin has to manually clean up the PV and the underlying storage. This is the safe default for important data.

**Delete:** The PV and the underlying storage are automatically deleted when the PVC is deleted. Convenient for development, terrifying in production if someone deletes the wrong PVC.

**Recycle (deprecated):** The volume is scrubbed and made available again. Don't use this. It's been deprecated for years.

I set production StorageClasses to Retain. Storage is cheap. Data loss is expensive. If someone accidentally deletes a PVC, I'd rather have an orphaned PV to reattach than a deleted disk to recover from backups (assuming backups exist, which is a whole other conversation).

## WaitForFirstConsumer

The `volumeBindingMode` setting controls when the PV is actually provisioned.

**Immediate** (the default): The PV is created as soon as the PVC is created, regardless of whether any pod is using it. This can cause problems with topology-aware storage. The PV might get created in zone A, but the pod gets scheduled to zone B. Now the volume can't be attached.

**WaitForFirstConsumer:** The PV isn't created until a pod that references the PVC is scheduled. Kubernetes knows which node the pod will run on, so it creates the volume in the same zone. This is almost always what you want.

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: regional-ssd
provisioner: kubernetes.io/aws-ebs
parameters:
  type: gp3
volumeBindingMode: WaitForFirstConsumer
```

I've hit the Immediate-mode zone mismatch problem exactly once, and it took me an embarrassingly long time to figure out why the pod was stuck in ContainerCreating. WaitForFirstConsumer prevents it entirely.

## Real example: running nginx with persistent storage

Let's put it all together. Here's a complete setup: StorageClass, PVC, and a Deployment with persistent storage.

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: standard
provisioner: kubernetes.io/aws-ebs
parameters:
  type: gp3
reclaimPolicy: Retain
volumeBindingMode: WaitForFirstConsumer
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: nginx-content
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: standard
  resources:
    requests:
      storage: 5Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
spec:
  replicas: 1
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:1.25
          volumeMounts:
            - mountPath: /usr/share/nginx/html
              name: content
      volumes:
        - name: content
          persistentVolumeClaim:
            claimName: nginx-content
```

Deploy this, write some files to `/usr/share/nginx/html` inside the pod, delete the pod, and watch the new pod spin up with the same data intact. It's a simple demonstration, but it's the foundation that databases, message queues, and every stateful workload in Kubernetes builds on.

## The hostPath gotcha

You'll notice my PV example above uses `hostPath`. Don't do this in production. `hostPath` mounts a directory from the node's filesystem. It's not replicated, it's not backed by cloud storage, and if the pod gets scheduled to a different node, the data is gone. It's the same problem you started with, just at the node level instead of the container level.

hostPath is useful for single-node development clusters and for kubelet-related volumes. For anything else, use a real provisioner.



Persistent storage in Kubernetes requires understanding a few more objects than you might expect (PV, PVC, StorageClass), but the model makes sense once you see it in action. The separation between provisioning (PV/StorageClass) and consumption (PVC/pod) gives you flexibility: storage admins manage the infrastructure, developers request what they need, and Kubernetes handles the binding.

Start with dynamic provisioning and a StorageClass. Set `reclaimPolicy: Retain`. Use `WaitForFirstConsumer`. Those three choices will save you from the most common storage-related outages I've seen.