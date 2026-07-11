---
title: "Your Pod Won't Start: Decoding OpenShift's Security Context Constraints"
slug: "openshift-security-context-constraints"
date: 2023-02-08
category: "OpenShift"
tags: ["openshift", "security", "scc", "containers", "rbac"]
readingTime: "10 min read"
excerpt: "Your pod won't start. The error says: unable to validate against any security context constraint. Here's what that means and how to fix it."
---

Your pod won't start. You check the events:

```
Warning  FailedCreate  3s (x12 over 45s)  replicaset-controller
Error creating: pods "my-app-7f8b9-" is forbidden:
unable to validate against any security context constraint:
[provider "anyuid": ...
```

You stare at it. The YAML looks fine. It works on your local kind cluster. It worked on your old Kubernetes cluster. But here, on OpenShift, it refuses to run.

Welcome to SecurityContextConstraints. This is the first OpenShift-specific concept that trips up every developer coming from vanilla Kubernetes. I've seen this error more times than I can count.

<!-- truncate -->

## What are SCCs?

SecurityContextConstraints (SCCs) are OpenShift's way of controlling what a pod is allowed to do. They're the OpenShift equivalent of Kubernetes PodSecurityPolicies (PSPs), which were removed in Kubernetes 1.25. OpenShift had SCCs long before PSPs existed, and they're still the primary security enforcement mechanism.

The API lives under `security.openshift.io/v1`:

```bash
# List all SCCs
oc get scc
```

```
NAME               PRIV    CAPS   SELINUX    RUNASUSER          FSGROUP     SUPGROUP    PRIORITY   READONLYROOTFS   VOLUMES
anyuid             false   []     MustRunAs  RunAsAny           RunAsAny    RunAsAny    10         false            [configMap downwardAPI emptyDir persistentVolumeClaim projected secret]
hostnetwork        false   []     MustRunAs  MustRunAsRange     MustRunAs   RunAsAny    <none>     false            [configMap downwardAPI emptyDir persistentVolumeClaim secret]
hostaccess         false   []     MustRunAs  MustRunAsRange     MustRunAs   RunAsAny    <none>     false            [configMap downwardAPI emptyDir persistentVolumeClaim secret]
hostmount-anyuid   false   []     MustRunAs  RunAsAny           RunAsAny    RunAsAny    <none>     false            [configMap downwardAPI emptyDir hostPath persistentVolumeClaim projected secret]
privileged         true    []     RunAsAny   RunAsAny           RunAsAny    RunAsAny    <none>     false            [*]
restricted         false   []     MustRunAs  MustRunAsRange     MustRunAs   RunAsAny    <none>     false            [configMap downwardAPI emptyDir persistentVolumeClaim projected secret]
restricted-v2      false   []     MustRunAs  MustRunAsRange     MustRunAs   RunAsAny    <none>     true             [configMap downwardAPI emptyDir persistentVolumeClaim projected secret]
```

That's a lot of SCCs. Let's focus on the ones that matter.

## The restricted SCC: why your pod fails

By default, OpenShift assigns the `restricted` (or `restricted-v2` on OCP 4.12+) SCC to pods. This SCC enforces:

1. **Run as non-root.** Your container cannot run as UID 0.
2. **No privileged containers.** No `securityContext.privileged: true`.
3. **Limited capabilities.** No `NET_ADMIN`, `SYS_ADMIN`, etc.
4. **Must run as a specific UID range.** Each project gets a UID range, and your pod must use a UID from that range.

The `restricted-v2` SCC, introduced in OCP 4.12, adds one more thing: `readOnlyRootFilesystem: true` by default. Containers can't write to their root filesystem. (They can still write to mounted volumes.)

Most "my pod won't start on OpenShift" errors come from one of these restrictions.

## The most common break: running as root

Docker images that assume root access break on OpenShift. This is common with official images that haven't been updated:

```yaml
# This will fail with the restricted SCC
apiVersion: v1
kind: Pod
metadata:
  name: nginx-test
spec:
  containers:
  - name: nginx
    image: nginx:1.23
    # nginx's default config tries to write to /var/cache/nginx
    # and listen on port 80 (privileged port)
```

The fix depends on the image. For nginx, you either:

1. Use an nginx image that runs as non-root (Red Hat's UBI-based nginx)
2. Override the user in the container spec
3. Assign a different SCC (more on this below)

```yaml
# Option 1: specify a non-root user
apiVersion: v1
kind: Pod
metadata:
  name: nginx-test
spec:
  containers:
  - name: nginx
    image: nginx:1.23
    securityContext:
      runAsUser: 1001
      allowPrivilegeEscalation: false
    ports:
    - containerPort: 8080  # non-privileged port
```

But this only works if the image is designed to run as non-root. If it's not, you need a different approach.

## Checking which SCC your pod uses

When a pod is running, you can check which SCC was assigned:

```bash
# Check the pod's annotation
oc get pod my-pod -o jsonpath='{.metadata.annotations.openshift\.io/scc}'
# Output: restricted-v2
```

Or check what SCC a pod *would* get before deploying:

```bash
oc create -f my-pod.yaml --dry-run=server 2>&1 | grep -i scc
```

## SCCs that matter (and when to use them)

**restricted / restricted-v2** (default): For most applications. Run as non-root, no special capabilities, read-only root filesystem (v2). This is what you want 90% of the time.

**anyuid**: Allows containers to run as any UID, including root. Use this when you have a legacy image that can't run as non-root. In most projects I've worked on, this need has been mostly eliminated, but some old vendor images still require it.

```bash
# Grant anyuid to a service account
oc adm policy add-scc-to-user anyuid -z my-service-account -n my-project
```

**hostnetwork**: Allows pods to use the host's network namespace. You need this for CNI plugins, monitoring agents that capture traffic, or anything that needs to bind to host ports directly.

**privileged**: Full access. Reserved for system components, node-level agents, and things like storage drivers. You should almost never use this for application workloads.

**hostmount-anyuid**: Allows mounting host paths and running as any UID. This is a "I know what I'm doing" SCC. Be careful with it.

## The practical fix for a failing deployment

Here's the workflow I walk developers through when they hit this error:

**Step 1: Read the error message.** It tells you exactly which constraints failed. Look for keywords like "runAsUser", "capabilities", "volumes".

**Step 2: Check if the image can run as non-root.** Most modern images (including Red Hat's UBI images) can. Check the Dockerfile or the image documentation.

**Step 3: If non-root works, set the security context:**

```yaml
spec:
  containers:
  - name: my-app
    image: my-app:1.0
    securityContext:
      runAsNonRoot: true
      allowPrivilegeEscalation: false
      capabilities:
        drop: ["ALL"]
    ports:
    - containerPort: 8080
```

**Step 4: If the image truly needs root or special capabilities, grant a more permissive SCC:**

```bash
# Check what SCCs are available
oc get scc

# Grant anyuid to the deployment's service account
oc adm policy add-scc-to-user anyuid -z my-deployment-sa -n my-project
```

**Step 5: Restart the pod.** SCC assignment happens at pod creation time. Changing the SCC after the pod exists doesn't retroactively apply. Delete the pod and let the ReplicaSet recreate it.

## How SCCs interact with RBAC

SCCs aren't just about pods. They're tied to RBAC. A user (or service account) must have permission to use an SCC before a pod using that SCC can be created:

```bash
# See who can use which SCC
oc describe scc anyuid

# See which users/groups can use it
# Look at the "Users:" and "Groups:" fields
```

The `system:serviceaccounts:<namespace>` group is commonly granted SCCs. When you run `oc adm policy add-scc-to-user`, you're adding to this RBAC mapping.

## restricted-v2 in OCP 4.12+

OCP 4.12 introduced `restricted-v2` as the new default. The main difference from `restricted`:

- Read-only root filesystem enabled by default
- Drops all capabilities by default
- Sets `allowPrivilegeEscalation: false` by default

This is stricter, and it broke some applications that were writing to the root filesystem at runtime (temp files, cache directories, PID files). The fix is usually a `tmpfs` volume mount:

```yaml
spec:
  containers:
  - name: my-app
    image: my-app:1.0
    volumeMounts:
    - name: tmp
      mountPath: /tmp
  volumes:
  - name: tmp
    emptyDir: {}
```

Or explicitly set `readOnlyRootFilesystem: false` if the application truly needs writable root filesystem (though the better fix is to make the application work with read-only root).

## The mental model

Think of SCCs as a security policy that sits between your pod spec and the Kubernetes admission pipeline. When you submit a pod, OpenShift checks: does the user (or service account) have permission to use an SCC that permits what this pod is asking for? If yes, the pod runs. If no, it's rejected.

The `restricted` SCC is deliberately conservative. It forces you to think about what your container actually needs. Most of the time, the answer is: not much. Run as non-root, use a non-privileged port, write to mounted volumes instead of the root filesystem.

When you need more, OpenShift has graduated levels of permission. Just don't jump straight to `privileged` because a pod won't start. Read the error, understand the constraint, and use the least permissive SCC that works.