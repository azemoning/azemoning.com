---
title: "Stop Putting Environment Variables Directly in Your Deployment Manifests"
slug: "stop-hardcoding-env-vars-kubernetes"
date: 2020-06-10
category: "Kubernetes"
tags: ["kubernetes", "configmaps", "secrets", "configuration", "12-factor"]
readingTime: "8 min read"
excerpt: "Hardcoded env vars in Deployment specs are a maintenance nightmare. ConfigMaps and Secrets exist for a reason."
---

Stop putting environment variables directly in your Deployment manifests.

I see this constantly. A container spec with database URLs, API endpoints, feature flags, and sometimes even credentials, all spelled out as `value` entries under `env`. It works fine when you have one environment. Then you need staging. Then you need production. Now you have three copies of the same Deployment with different values, and you're manually syncing changes between them. Someone updates the staging manifest but forgets production. Classic.

ConfigMaps and Secrets fix this. They separate configuration from workload definition, which is the entire point of the 12-factor app methodology. Let me show you how, and then let me show you the parts that bite people.

<!-- truncate -->

## ConfigMaps: your configuration, externalized

A ConfigMap is a Kubernetes object that stores key-value pairs. You create it separately from your Deployment, then reference it in the container spec. Change the ConfigMap, and (with some caveats) the pods pick up the new values.

Here's a ConfigMap for an application's non-sensitive configuration:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: myapp-config
data:
  DATABASE_HOST: "postgres-service.default.svc.cluster.local"
  DATABASE_PORT: "5432"
  LOG_LEVEL: "info"
  FEATURE_FLAG_NEW_UI: "false"
  MAX_CONNECTIONS: "100"
```

Now reference it in your Deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
        - name: myapp
          image: nginx:1.17
          ports:
            - containerPort: 80
          envFrom:
            - configMapRef:
                name: myapp-config
```

`envFrom` injects every key from the ConfigMap as an environment variable. The container sees `DATABASE_HOST`, `LOG_LEVEL`, etc. as if you'd set them inline. The difference is that the ConfigMap is a separate object you can manage independently.

You can also inject individual keys if you don't want the whole ConfigMap:

```yaml
env:
  - name: DB_HOST
    valueFrom:
      configMapKeyRef:
        name: myapp-config
        key: DATABASE_HOST
```

This lets you rename keys during injection, which is useful when your ConfigMap key names don't match what the app expects.

## Different configs per environment

Here's where it pays off. You create one ConfigMap per environment:

```bash
kubectl create configmap myapp-config-dev --from-literal=DATABASE_HOST=postgres.dev.svc.cluster.local --from-literal=LOG_LEVEL=debug
kubectl create configmap myapp-config-staging --from-literal=DATABASE_HOST=postgres.staging.svc.cluster.local --from-literal=LOG_LEVEL=info
kubectl create configmap myapp-config-prod --from-literal=DATABASE_HOST=postgres.prod.svc.cluster.local --from-literal=LOG_LEVEL=warn
```

Your Deployment manifest stays the same across environments. Only the ConfigMap name changes (use Kustomize, Helm, or whatever templating you prefer to swap it).

## Secrets: same idea, different handling

Secrets look like ConfigMaps but with two key differences: the values are base64-encoded, and Kubernetes treats them differently in terms of storage and access control.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: myapp-secrets
type: Opaque
data:
  DATABASE_PASSWORD: cGFzc3dvcmQxMjM=
  API_KEY: c2VjcmV0LWFwaS1rZXk=
```

The `data` field takes base64-encoded values. Create them with:

```bash
echo -n 'password123' | base64
```

Or use the imperative command which handles encoding for you:

```bash
kubectl create secret generic myapp-secrets --from-literal=DATABASE_PASSWORD=password123 --from-literal=API_KEY=secret-api-key
```

Reference Secrets the same way as ConfigMaps:

```yaml
envFrom:
  - secretRef:
      name: myapp-secrets
```

Or individual keys:

```yaml
env:
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: myapp-secrets
        key: DATABASE_PASSWORD
```

## The gotchas (here's where people get burned)

**ConfigMap updates are not instant.** When you update a ConfigMap, pods that reference it via `envFrom` or `env` do NOT get the new values automatically. Environment variables are set at container start time. You need to restart the pods (rolling update, delete them, whatever). Mounted ConfigMaps (via `volumeMounts`) do update eventually (kubelet syncs them, typically within the `sync period` plus cache TTL), but environment variables don't.

This is the number one thing that surprises people. They update the ConfigMap, wait, and wonder why the app is still using old values.

**Secrets are base64-encoded, not encrypted.** Base64 is encoding, not encryption. Anyone with access to the Secret can decode the values trivially. "But Kubernetes encrypts Secrets at rest!" Only if you've configured an encryption provider in your API server. By default, Secrets are stored in etcd as plain base64. Don't assume they're secure just because they're Secrets.

For actual secret management, consider:
- External secret managers (HashiCorp Vault, AWS Secrets Manager, etc.)
- Sealed Secrets (encrypts Secrets so they're safe to store in Git)
- Encrypted at rest configuration for etcd

**ConfigMap size limits.** A single ConfigMap can be up to 1 MiB (this includes the key names and values). If you need more, use multiple ConfigMaps or mount files from a volume.

**Immutability.** Starting in Kubernetes 1.18 (beta), you can mark a ConfigMap or Secret as immutable:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: myapp-config
immutable: true
data:
  LOG_LEVEL: "info"
```

This prevents accidental updates and improves performance (kubelet doesn't need to watch for changes). Use this for configs that don't change at runtime. Once you set `immutable: true`, you can't change it back or modify the data. You have to delete and recreate the ConfigMap.

## Mounting vs injecting

Everything above uses `envFrom` or `env` to inject ConfigMap/Secret values as environment variables. The alternative is mounting them as files:

```yaml
volumes:
  - name: config-volume
    configMap:
      name: myapp-config
containers:
  - name: myapp
    image: nginx:1.17
    volumeMounts:
      - name: config-volume
        mountPath: /etc/config
```

This creates a file per key under `/etc/config`. Useful when your app reads config from files rather than environment variables, or when you have large config blobs (nginx.conf, application.yml, etc.).

The trade-off: file-mounted configs update automatically (with a delay), but environment variable injection doesn't. File-mounted configs require the app to watch for file changes or be restarted to pick them up.

## The right pattern

My preference for most web applications:

1. **ConfigMaps** for non-sensitive, environment-specific configuration. Injected as environment variables.
2. **Secrets** for credentials and API keys. Managed through an external secret manager or Sealed Secrets. Injected as environment variables.
3. **Mounted files** for large config blobs that the app reads from disk (nginx configs, complex YAML configs).

Keep your Deployment manifests config-free. They define the workload (image, replicas, probes, resource limits). Configuration lives in ConfigMaps and Secrets. That separation makes multi-environment management sane.



Externalizing configuration isn't optional for anything beyond toy projects. The moment you have a second environment, hardcoding env vars becomes a maintenance burden that compounds with every config change. ConfigMaps and Secrets are the Kubernetes-native answer, and while they have rough edges (the update lag, the base64-is-not-encryption issue), they're the right foundation. Build on them.