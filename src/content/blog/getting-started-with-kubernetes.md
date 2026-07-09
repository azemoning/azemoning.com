---
title: "Getting Started with Kubernetes"
date: 2026-07-08
category: "Kubernetes"
tags: ["kubernetes", "docker", "containers"]
readingTime: "5 min read"
excerpt: "A beginner's guide to understanding Kubernetes core concepts."
---

Kubernetes has become the de facto standard for container orchestration. In this post, we'll cover the fundamental concepts you need to get started.

## Core Concepts

### Pods
The smallest deployable unit in Kubernetes. A pod wraps one or more containers.

### Services
Services provide stable networking for pods. They load balance traffic across matching pods.

### Deployments
Deployments manage the desired state of your application, handling rolling updates and rollbacks.

## Your First Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
spec:
  replicas: 3
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
        ports:
        - containerPort: 80
```

Apply it with:

```bash
kubectl apply -f deployment.yaml
```

## What's Next?

- Learn about ConfigMaps and Secrets
- Explore Ingress controllers
- Set up monitoring with Prometheus
