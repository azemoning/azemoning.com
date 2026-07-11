---
title: "Your App Pods Can Talk to the Kubernetes API (And You Probably Didn't Know)"
slug: "kubernetes-rbac-your-pods-can-talk-to-the-api"
date: 2020-12-08
category: "Kubernetes"
tags: ["kubernetes", "rbac", "security", "service-accounts", "least-privilege"]
readingTime: "11 min read"
excerpt: "By default, every pod in your cluster has API access. RBAC is how you lock that down."
---

You just realized your app pods can talk to the Kubernetes API.

I mean it. Open a shell inside any running pod and try this:

```bash
curl -k https://kubernetes.default.svc/api/v1/namespaces/default/pods \
  -H "Authorization: Bearer *** /var/run/secrets/kubernetes.io/serviceaccount/token)"
```

If you haven't touched RBAC, this returns a list of pods. Your application code, running inside a pod, can query (and depending on the default setup, even modify) Kubernetes objects. That's a problem if that pod ever gets compromised, has a dependency with a vulnerability, or is running code from a supply chain attack.

The fix is RBAC: Role-Based Access Control. It's been stable since Kubernetes 1.8. There's no excuse not to use it.

<!-- truncate -->

## How pod-to-API communication works

Every pod gets a service account. By default, this is the `default` service account in the pod's namespace. Kubernetes automatically mounts a token for this service account at `/var/run/secrets/kubernetes.io/serviceaccount/token` inside every container.

The API server's address and CA cert are also mounted:

```bash
cat /var/run/secrets/kubernetes.io/serviceaccount/token   # the bearer token
cat /var/run/secrets/kubernetes.io/serviceaccount/ca.crt   # the API server's CA
cat /var/run/secrets/kubernetes.io/serviceaccount/namespace # the pod's namespace
```

Any code in the pod can use these to authenticate to the API server. What it can do depends on the RBAC rules bound to that service account.

Here's the problem: in many clusters, the `default` service account has been granted permissions (sometimes cluster-admin!) because someone needed their app to talk to the API and couldn't be bothered to create a proper role. Or a Helm chart shipped with overly permissive RBAC rules. Or nobody thought about it at all.

## RBAC objects: the four pieces

RBAC in Kubernetes involves four resource types, all under `rbac.authorization.k8s.io/v1`:

**Role:** Defines what actions are allowed on which resources within a single namespace.

**ClusterRole:** Same as a Role but cluster-wide (or for cluster-scoped resources like Nodes).

**RoleBinding:** Grants a Role (or ClusterRole) to a user, group, or service account within a namespace.

**ClusterRoleBinding:** Grants a ClusterRole to a user, group, or service account across the entire cluster.

The flow is: define what's allowed (Role/ClusterRole), then attach it to who needs it (RoleBinding/ClusterRoleBinding).

## Example: let a pod read ConfigMaps and nothing else

This is a common real-world need. An application needs to read ConfigMaps (maybe to watch for configuration changes) but shouldn't be able to read Secrets, delete Deployments, or do anything else.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: configmap-reader
  namespace: default
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "watch"]
```

This Role allows reading ConfigMaps in the `default` namespace. The empty string `""` in `apiGroups` means the core API group (Pods, Services, ConfigMaps, Secrets, etc. all live there).

Now create a service account for the app:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: myapp-sa
  namespace: default
```

Bind the Role to the service account:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: myapp-configmap-reader
  namespace: default
subjects:
  - kind: ServiceAccount
    name: myapp-sa
    namespace: default
roleRef:
  kind: Role
  name: configmap-reader
  apiGroup: rbac.authorization.k8s.io
```

Then use the service account in your Deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  namespace: default
spec:
  replicas: 2
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      serviceAccountName: myapp-sa
      containers:
        - name: myapp
          image: busybox:1.33
          command: ['sleep', '3600']
```

Now verify from inside the pod. The pod can read ConfigMaps:

```bash
curl -k https://kubernetes.default.svc/api/v1/namespaces/default/configmaps \
  -H "Authorization: Bearer *** /var/run/secrets/kubernetes.io/serviceaccount/token)"
```

But trying to read Secrets will fail:

```bash
curl -k https://kubernetes.default.svc/api/v1/namespaces/default/secrets \
  -H "Authorization: Bearer *** /var/run/secrets/kubernetes.io/serviceaccount/token)"
# Returns 403 Forbidden
```

That's least privilege in action.

## Verifying what a service account can do

The `kubectl auth can-i` command is your friend:

```bash
kubectl auth can-i list configmaps --as=system:serviceaccount:default:myapp-sa
# yes

kubectl auth can-i get secrets --as=system:serviceaccount:default:myapp-sa
# no

kubectl auth can-i delete pods --as=system:serviceaccount:default:myapp-sa
# no
```

Use this to verify your RBAC setup before deploying. It's faster than testing from inside a pod.

## ClusterRole vs Role: when you need cluster scope

Use a ClusterRole when:
- The service account needs to read cluster-scoped resources (Nodes, PersistentVolumes, Namespaces)
- You want to define permissions once and bind them across multiple namespaces

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: node-reader
rules:
  - apiGroups: [""]
    resources: ["nodes"]
    verbs: ["get", "list"]
```

Bind it with a ClusterRoleBinding for cluster-wide access, or with a RoleBinding in a specific namespace (yes, you can bind a ClusterRole with a RoleBinding to scope it to a single namespace).

## The common mistakes

**Using `cluster-admin` for app pods.** I've seen Helm charts that create a ClusterRoleBinding to `cluster-admin` for a service account. This gives the pod full control over the entire cluster. If that pod is compromised, the attacker owns your cluster. Never do this for application workloads.

**Not setting `automountServiceAccountToken: false` when the pod doesn't need API access.** Most application pods don't need to talk to the Kubernetes API at all. Disable token auto-mounting:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp
spec:
  automountServiceAccountToken: false
  containers:
    - name: myapp
      image: busybox:1.33
      command: ['sleep', '3600']
```

This prevents the token from being mounted entirely. No token, no API access.

**Overly broad verbs.** Don't grant `"*"` (all verbs) when you only need `"get"`. The `list` and `watch` verbs can return data for all resources of a type. The `create`, `update`, `delete` verbs can modify cluster state. Be specific.

**Forgetting about `escalate` and `bind`.** If you grant a service account the ability to create or modify Roles and RoleBindings, it can grant itself more permissions. This is privilege escalation. Don't give app pods RBAC write access.

## Auditing what's currently in place

If you're inheriting a cluster and want to see what RBAC rules exist:

```bash
# List all Roles in a namespace
kubectl get roles -n default

# List all ClusterRoles
kubectl get clusterroles

# Describe a specific role to see its rules
kubectl describe clusterrole cluster-admin

# List all RoleBindings
kubectl get rolebindings -n default

# List all ClusterRoleBindings
kubectl get clusterrolebindings
```

Look for any binding that targets `system:serviceaccount:*:default` (the default service account in any namespace). That's usually a sign that someone needed API access and took the easy route.

## A practical checklist

For every new namespace and workload:

1. Create a dedicated service account (don't use `default`)
2. Set `automountServiceAccountToken: false` unless the pod needs API access
3. If it needs API access, create a Role with minimum permissions
4. Bind the Role to the specific service account
5. Verify with `kubectl auth can-i`
6. Test from inside the pod



RBAC isn't hard. The concepts are simple: define permissions, bind them to identities. The hard part is organizational: getting teams to actually use it instead of granting `cluster-admin` and moving on. Start by auditing what you have. Fix the worst offenders. Enforce the pattern for new workloads. The security improvement is disproportionate to the effort.