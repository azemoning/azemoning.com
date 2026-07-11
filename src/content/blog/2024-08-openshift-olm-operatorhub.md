---
title: "Installing Operators on OpenShift: Skip the Helm Chart, Use OperatorHub"
slug: "openshift-olm-operatorhub"
date: 2024-08-22
category: "OpenShift"
tags: ["openshift", "operators", "olm", "operatorhub", "helm"]
readingTime: "8 min read"
excerpt: "You need to install a database operator. In vanilla Kubernetes, you'd use Helm. In OpenShift, there's a better way."
---

You need to install a database operator. PostgreSQL, maybe, or Redis. In vanilla Kubernetes, you'd grab a Helm chart, read the README, customize the values file, and `helm install`. On OpenShift, you can do that too. But there's a better way.

<!-- truncate -->

## OperatorHub: the operator marketplace

OpenShift's web console has a section called **OperatorHub**. It's a marketplace of operators curated by Red Hat and the community. Navigate to **Operators** > **OperatorHub** in the console, and you'll find hundreds of operators organized by category: databases, monitoring, networking, security, storage, and more.

Under the hood, OperatorHub is powered by the Operator Lifecycle Manager (OLM). OLM manages the lifecycle of operators: installation, upgrades, dependency resolution, and removal.

## Installing an operator from the console

The console path is the easiest. Let's say you want to install the Crunchy Data PostgreSQL operator:

1. Go to **Operators** > **OperatorHub**
2. Search for "PostgreSQL"
3. Click the Crunchy Data operator
4. Click **Install**
5. Choose the update channel, approval strategy, and namespace
6. Click **Install**

OLM creates a Subscription, resolves dependencies, creates an InstallPlan, and installs the operator. A few minutes later, you can create PostgreSQL clusters.

But let's look at what actually happened.

## What OLM created behind the scenes

Three resources:

### Subscription

The Subscription tells OLM which operator to install and from where:

```yaml
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: postgresql
  namespace: openshift-operators
spec:
  channel: stable
  name: postgresql
  source: certified-operators
  sourceNamespace: openshift-marketplace
  installPlanApproval: Automatic
```

Key fields:
- `channel`: The update channel (stable, alpha, etc.)
- `source`: The catalog source (certified-operators, community-operators, redhat-operators)
- `installPlanApproval`: `Automatic` or `Manual`

```bash
# List subscriptions
oc get sub -n openshift-operators

# Describe a subscription
oc describe sub postgresql -n openshift-operators
```

### InstallPlan

The InstallPlan is a resolved set of resources to install. OLM generates it from the Subscription:

```bash
# List install plans
oc get ip -n openshift-operators

# View the install plan details
oc get ip install-abc123 -n openshift-operators -o yaml
```

With `installPlanApproval: Automatic`, the InstallPlan is approved and applied automatically. With `Manual`, an admin must approve it:

```bash
# Approve a manual install plan
oc patch ip install-abc123 -n openshift-operators --type merge -p '{"spec":{"approved":true}}'
```

### ClusterServiceVersion (CSV)

The CSV is the operator's metadata and deployment spec. It defines what the operator installs, what CRDs it provides, what permissions it needs, and how to deploy it:

```bash
# List CSVs
oc get csv -n openshift-operators

# View a specific CSV
oc describe csv postgresql.v5.4.0 -n openshift-operators
```

The CSV includes the operator's deployment (container image, resource requirements, RBAC rules) and information about the Custom Resource Definitions (CRDs) the operator manages.

## Installing from the CLI

If you prefer the terminal:

```bash
# Create the subscription
cat <<EOF | oc apply -f -
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: my-postgresql-operator
  namespace: openshift-operators
spec:
  channel: stable-v5
  name: postgresql
  source: certified-operators
  sourceNamespace: openshift-marketplace
  installPlanApproval: Automatic
EOF

# Watch the operator install
oc get csv -n openshift-operators -w

# Once installed, create an instance
oc get crd | grep postgresql
```

## Catalog sources

Operators come from catalog sources. OpenShift ships with several:

| Source | Content |
|--------|---------|
| `redhat-operators` | Red Hat products (AMQ, Fuse, Quay, etc.) |
| `certified-operators` | Third-party certified operators (Crunchy, MongoDB, etc.) |
| `community-operators` | Community-maintained operators |
| `redhat-marketplace` | Red Hat Marketplace operators |

You can add custom catalog sources for internal operators:

```yaml
apiVersion: operators.coreos.com/v1alpha1
kind: CatalogSource
metadata:
  name: internal-operators
  namespace: openshift-marketplace
spec:
  sourceType: grpc
  image: registry.internal.company.com/catalogs/internal-catalog:latest
  displayName: Internal Operators
  publisher: Platform Team
```

In a previous project, we maintained a custom catalog source for operators that aren't in the public catalogs. This includes custom operators for our internal services.

## Operator groups and namespace-scoped installs

By default, cluster-scoped operators install into `openshift-operators`. Namespace-scoped operators need an OperatorGroup in the target namespace:

```yaml
apiVersion: operators.coreos.com/v1
kind: OperatorGroup
metadata:
  name: my-project-og
  namespace: my-project
spec:
  targetNamespaces:
  - my-project
```

Then install the operator into that namespace:

```yaml
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: my-postgresql-operator
  namespace: my-project
spec:
  channel: stable-v5
  name: postgresql
  source: certified-operators
  sourceNamespace: openshift-marketplace
```

Namespace-scoped operators only watch resources in their configured namespaces. Cluster-scoped operators watch the entire cluster.

## Operator upgrades

OLM handles upgrades. When a new version is available in the catalog:

- With `installPlanApproval: Automatic`, OLM upgrades automatically
- With `installPlanApproval: Manual`, you get a pending InstallPlan to approve

```bash
# Check for pending upgrades
oc get ip -n my-project | grep -i approved

# View upgrade history
oc get csv -n my-project -o custom-columns=NAME:.metadata.name,PHASE:.status.phase,VERSION:.spec.version
```

## Using an operator after installation

Once installed, operators provide Custom Resources. For example, the Crunchy Data PostgreSQL operator provides:

```bash
oc get crd | grep postgres
```

```
pgupgrades.postgres-operator.crunchydata.com
postgresclusters.postgres-operator.crunchydata.com
```

Create a PostgreSQL cluster:

```yaml
apiVersion: postgres-operator.crunchydata.com/v1beta1
kind: PostgresCluster
metadata:
  name: my-pg-cluster
  namespace: my-project
spec:
  image: registry.developers.crunchydata.com/crunchydata/crunchy-postgres:ubi8-15.3
  postgresVersion: 15
  instances:
  - name: instance1
    replicas: 2
    dataVolumeClaimSpec:
      accessModes:
      - ReadWriteOnce
      resources:
        requests:
          storage: 10Gi
  backups:
    pgbackrest:
      repos:
      - name: repo1
        volume:
          volumeClaimSpec:
            accessModes:
            - ReadWriteOnce
            resources:
              requests:
                storage: 10Gi
```

No Helm chart, no manual operator installation, no configuring RBAC for the operator. The operator handles replication, backups, failover, and monitoring. That's the value of the OperatorHub approach.

## OLM vs Helm for operator installation

| Aspect | OLM (OperatorHub) | Helm |
|--------|-------------------|------|
| Upgrade management | Automatic or manual approval | Manual `helm upgrade` |
| Dependency resolution | Built-in | Manual |
| CRD lifecycle | Managed by OLM | Manual (Helm has CRD limitations) |
| Web UI | Yes (OperatorHub) | No (CLI only) |
| Catalog/marketplace | Built-in | ArtifactHUB (external) |
| Uninstall cleanup | Automatic | Depends on chart |

Helm is great for deploying applications. OLM is great for managing operators. They solve different problems. On OpenShift, OLM is the standard way to install and manage operators. Use it.