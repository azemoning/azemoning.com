---
title: "You Didn't Install Prometheus. OpenShift Did."
slug: "openshift-built-in-monitoring"
date: 2023-06-14
category: "OpenShift"
tags: ["openshift", "monitoring", "prometheus", "grafana", "thanos"]
readingTime: "8 min read"
excerpt: "Where are your metrics? You didn't install Prometheus. OpenShift did it for you. Here's how to use the built-in monitoring stack."
---

Where are your metrics?

If you're coming from vanilla Kubernetes, the answer to "how do I monitor my cluster?" usually starts with a Helm chart, a Prometheus Operator install, maybe some Grafana dashboards from a community repo. It takes an afternoon if you know what you're doing, a weekend if you don't.

On OpenShift, the answer is: they're already there. You didn't install Prometheus. OpenShift did it for you.

<!-- truncate -->

## The openshift-monitoring namespace

When an OpenShift cluster boots for the first time, the Cluster Monitoring Operator (CMO) deploys a full monitoring stack into the `openshift-monitoring` namespace:

```bash
oc get pods -n openshift-monitoring
```

```
NAME                                             READY   STATUS    RESTARTS   AGE
alertmanager-main-0                              5/5     Running   0          7d
alertmanager-main-1                              5/5     Running   0          7d
alertmanager-main-2                              5/5     Running   0          7d
cluster-monitoring-operator-6c8f7f8f5d-abc12    1/1     Running   0          7d
grafana-7b9f8c6d4e-def34                         2/2     Running   0          7d
kube-state-metrics-6f7b8c9d5e-ghi56              3/3     Running   0          7d
node-exporter-abc12                              2/2     Running   0          7d
openshift-state-metrics-7d8e9f0a1b-jkl78         3/3     Running   0          7d
prometheus-adapter-5c6d7e8f9a-mno90              1/1     Running   0          7d
prometheus-k8s-0                                 6/6     Running   0          7d
prometheus-k8s-1                                 6/6     Running   0          7d
telemeter-client-8e9f0a1b2c-pqr12                3/3     Running   0          7d
thanos-querier-7a8b9c0d1e-stu34                  3/3     Running   0          7d
```

That's Prometheus (in HA with two replicas), AlertManager (three replicas), Grafana, Thanos Querier, kube-state-metrics, node-exporter, and the monitoring operator itself. All running, all configured, all managed by the cluster.

You didn't write a single YAML to deploy any of this.

## What's already being monitored

The default stack monitors everything a cluster operator needs:

- **Node metrics** via node-exporter (CPU, memory, disk, network)
- **Kubernetes objects** via kube-state-metrics (pod status, deployment replicas, PVCs)
- **API server metrics** (request latency, error rates, etcd performance)
- **etcd metrics** (disk sync duration, leader changes, DB size)
- **Ingress/router metrics** (request rates, error rates, backend latency)

You can query Prometheus directly:

```bash
# Port-forward to the Prometheus UI
oc port-forward -n openshift-monitoring svc/prometheus-k8s 9090:9090

# Or use oc to query metrics via the API
oc get --raw '/api/v1/namespaces/openshift-monitoring/services/prometheus-k8s:9090/proxy/api/v1/query?query=up' | jq
```

But the easier way is through the OpenShift console. Go to **Observe** > **Metrics** and you get a built-in Prometheus expression browser. No setup needed.

## Thanos and long-term storage

The monitoring stack includes Thanos Querier, which gives you:

- **Long-term metrics** beyond Prometheus's local retention (default 15 days)
- **Multi-cluster querying** if you have multiple OpenShift clusters reporting to the same Thanos store
- **Deduplication** of metrics from the two Prometheus replicas

By default, the monitoring stack stores metrics in Prometheus's local TSDB. For long-term storage, you configure the Cluster Monitoring Operator to ship metrics to an object store (S3, GCS, Azure Blob, or any S3-compatible store like MinIO):

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: cluster-monitoring-config
  namespace: openshift-monitoring
data:
  config.yaml: |
    telemeterClient:
      enabled: true
    prometheusK8s:
      retention: 15d
      volumeClaimTemplate:
        spec:
          resources:
            requests:
              storage: 100Gi
```

In one of my projects, we used an internal S3-compatible store for long-term metrics retention. The configuration lives in the `cluster-monitoring-config` ConfigMap in the `openshift-monitoring` namespace.

## AlertManager: alerts are already configured

The AlertManager cluster comes pre-configured with alerts for:

- Nodes going down or becoming unreachable
- etcd leader changes or slow disk operations
- API server high error rates or latency
- Prometheus target scrape failures
- Certificate expiration warnings
- PersistentVolume filling up

You can see the alert rules:

```bash
# List all alerting rules
oc get prometheusrules -n openshift-monitoring

# Or through the console: Observe > Alerting
```

The AlertManager configuration lives in a Secret called `alertmanager-main` in the `openshift-monitoring` namespace. You can add your own receivers (email, Slack, PagerDuty, webhook) by editing this configuration:

```bash
# View current config
oc get secret alertmanager-main -n openshift-monitoring -o jsonpath='{.data.alertmanager.yaml}' | base64 -d
```

## User Workload Monitoring: your application metrics

The default monitoring stack covers the platform. But what about your application metrics?

This is where **User Workload Monitoring** comes in. OpenShift lets you enable monitoring for user-defined namespaces. Your applications can expose Prometheus-format metrics, and the monitoring stack will scrape them.

Enable it first:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: user-workload-monitoring-config
  namespace: openshift-user-workload-monitoring
data:
  config.yaml: |
    prometheus:
      retention: 24h
      volumeClaimTemplate:
        spec:
          resources:
            requests:
              storage: 50Gi
```

Then create a ServiceMonitor for your application:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: my-app
  namespace: my-project
spec:
  selector:
    matchLabels:
      app: my-app
  endpoints:
  - port: metrics
    interval: 30s
    path: /metrics
```

Your service needs a port named `metrics`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-app
  labels:
    app: my-app
spec:
  ports:
  - name: metrics
    port: 8080
    targetPort: 8080
  selector:
    app: my-app
```

Once the ServiceMonitor is created, your application's metrics appear in the OpenShift console under **Observe** > **Metrics** (switch the dropdown from "Platform" to "User"). No separate Prometheus install needed.

## Grafana

The built-in Grafana instance is read-only for non-admin users and comes pre-loaded with dashboards for cluster health, node performance, and Kubernetes resources. You can't add custom dashboards to it (it's managed by the operator).

If you need custom Grafana dashboards, deploy your own Grafana instance in your namespace and point it at the same Prometheus data source. The internal Prometheus endpoint is accessible within the cluster:

```
https://thanos-querier.openshift-monitoring.svc:9091
```

Use the service account token for authentication:

```bash
oc create token prometheus-k8s -n openshift-monitoring
```

## Things I learned the hard way

**Don't modify anything in openshift-monitoring directly.** The Cluster Monitoring Operator will overwrite your changes. All customization goes through the `cluster-monitoring-config` ConfigMap.

**The monitoring stack uses a lot of storage.** Plan for it. The default Prometheus retention is 15 days, and on a busy cluster with hundreds of pods, that can eat through disk fast.

**User Workload Monitoring is per-namespace.** Each namespace needs its own ServiceMonitor. There's no cluster-wide "monitor everything" toggle for user workloads.

**Alerting rules can be noisy.** The default alert set is conservative. You'll get alerts for things that aren't problems in your environment. Tune them. Don't just silence everything.

The biggest win of OpenShift's monitoring stack is that it removes the decision fatigue around observability. You don't have to choose between Prometheus Operator, Victoria Metrics, or Thanos. You don't have to configure RBAC for the monitoring namespace. You don't have to set up cert-manager for Prometheus's TLS. It's done. Focus on your ServiceMonitors and your alerts.