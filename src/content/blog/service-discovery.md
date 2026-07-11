---
title: "How Services Find Pods (And Why You Should Care)"
slug: "service-discovery"
date: 2022-04-22
category: "Kubernetes"
tags: ["kubernetes", "services", "networking", "endpoints"]
readingTime: "8 min read"
excerpt: "Pods die. Their IPs change. How do you find them? Services, and the networking model underneath."
---

Pods die. Their IPs change. How do you find them?

This is the fundamental question Kubernetes networking answers. Every pod gets its own IP address, which is great until you realize that pod IPs are ephemeral. A restart, a reschedule, a scaling event, and the IP you were talking to is gone. You could try to keep track of pod IPs manually, but that's what we did before service discovery was a thing, and it didn't go well.

Kubernetes Services solve this by giving you a stable IP and DNS name that routes to a dynamic set of pods. The Service doesn't care if the pods behind it change. It tracks them automatically and distributes traffic to whichever ones are healthy.

I want to walk through how this actually works, because the abstractions hide a surprising amount of machinery.

<!-- truncate -->

## The basic Service

Here's the simplest possible Service:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 8080
```

This creates a Service named `web` that routes traffic to any pod with the label `app: web`. Traffic sent to `web:80` gets forwarded to port 8080 on one of those pods.

The Service gets a cluster-internal IP (a ClusterIP). Inside the cluster, any pod can reach it at `web.default.svc.cluster.local` (or just `web` if they're in the same namespace). DNS resolves that name to the ClusterIP, and kube-proxy handles routing the ClusterIP to an actual pod.

## ClusterIP: the default

When you don't specify a `type`, the Service is a ClusterIP. It's reachable only from inside the cluster. No external traffic gets in.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api
spec:
  type: ClusterIP
  selector:
    app: api
  ports:
    - port: 443
      targetPort: 8443
```

ClusterIP is what I use for 90% of internal services. The API talks to the database via a ClusterIP Service. The frontend talks to the API via a ClusterIP Service. Everything stays inside the cluster. External access (if needed) goes through an Ingress or a LoadBalancer Service.

## NodePort: opening a port on every node

NodePort extends ClusterIP by opening a specific port (in the 30000-32767 range) on every node in the cluster. Traffic to `<any-node-ip>:<node-port>` gets routed to the Service.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web-external
spec:
  type: NodePort
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 8080
      nodePort: 30080
```

Now you can hit `http://<any-node-ip>:30080` and reach the web pods. This works, but it's awkward. You have to know node IPs. You have to manage port assignments to avoid conflicts. And you're exposing ports directly on your nodes, which makes security teams nervous.

I use NodePort mostly for development clusters or for services that need to be accessible from outside the cluster but don't have a cloud load balancer available. It's simple, it works, and it's not something you want for production external traffic.

## LoadBalancer: the cloud integration point

LoadBalancer creates an external load balancer (in cloud environments) that routes traffic to the Service. On AWS, this creates an ELB. On GCP, a Network Load Balancer. On bare metal, you need MetalLB or something similar.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web-lb
spec:
  type: LoadBalancer
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 8080
```

After applying this, check the external IP:

```bash
kubectl get svc web-lb
```

```
NAME     TYPE           CLUSTER-IP     EXTERNAL-IP     PORT(S)        AGE
web-lb   LoadBalancer   10.96.45.123   203.0.113.42    80:31234/TCP   2m
```

The `EXTERNAL-IP` is assigned by the cloud provider. Traffic to that IP on port 80 gets routed to your pods.

Every LoadBalancer Service creates a separate cloud load balancer. At $15-20/month each on most cloud providers, this gets expensive fast. If you have 20 services that need external access, that's $300-400/month just for load balancers. This is why Ingress controllers exist: one LoadBalancer Service for the Ingress controller, and the Ingress routes traffic to internal Services by hostname or path.

## Endpoints: the glue

Here's the part most people don't look at. Behind every Service, Kubernetes maintains an Endpoints object that lists the actual pod IPs.

```bash
kubectl get endpoints web
```

```
NAME   ENDPOINTS                                AGE
web    10.244.1.5:8080,10.244.2.8:8080          5m
```

The Endpoints object is automatically updated by the endpoints controller. When a pod matching the Service selector becomes Ready, its IP is added to the Endpoints. When a pod is deleted or becomes Not Ready, its IP is removed.

You can inspect the raw Endpoints object:

```bash
kubectl get endpoints web -o yaml
```

```yaml
apiVersion: v1
kind: Endpoints
metadata:
  name: web
subsets:
  - addresses:
      - ip: 10.244.1.5
        nodeName: node-1
        targetRef:
          kind: Pod
          name: web-app-7d4b8c6f9-x2kj4
          namespace: default
      - ip: 10.244.2.8
        nodeName: node-2
        targetRef:
          kind: Pod
          name: web-app-7d4b8c6f9-m5n8p
          namespace: default
    ports:
      - port: 8080
        protocol: TCP
```

This is the source of truth for where traffic goes. If you're debugging why traffic isn't reaching a pod, check the Endpoints first. Common reasons a pod might be missing:

- The pod's labels don't match the Service selector
- The pod is failing its readiness probe
- The pod is still starting up

## Manual Endpoints

Something not everyone knows: you can create an Endpoints object manually, without any pods. This is useful for pointing a Service at something outside the cluster.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: external-database
spec:
  type: ClusterIP
  ports:
    - port: 5432
      targetPort: 5432
---
apiVersion: v1
kind: Endpoints
metadata:
  name: external-database
subsets:
  - addresses:
      - ip: 10.0.1.50
    ports:
      - port: 5432
        protocol: TCP
```

The Service and Endpoints must have the same name. Without a selector, the Service doesn't try to manage Endpoints automatically. You create the Endpoints yourself, pointing to whatever IP you want. Internal pods can now reach `external-database:5432` and the traffic goes to 10.0.1.50.

I've used this to bridge clusters and to provide stable DNS names for legacy systems that haven't moved to Kubernetes yet.

## How kube-proxy fits in

The routing from ClusterIP to pod IP happens at the node level, managed by kube-proxy. kube-proxy watches the API server for Service and Endpoints changes and updates the node's packet filtering rules (iptables or IPVS) accordingly.

This means there's no single bottleneck for Service traffic. Each node handles routing independently. When pod 10.244.1.5 sends a request to Service `web`, the iptables rules on its node pick a backend pod (from the Endpoints list) and DNAT the traffic directly. It's efficient, but it does mean there's a small propagation delay when Endpoints change. A new pod gets added to the Endpoints, kube-proxy picks it up, and then traffic starts flowing. This delay is usually a few seconds at most.

If you're using IPVS mode (configured in kube-proxy), the routing is handled differently but the concept is the same. IPVS is faster for large numbers of Services because it uses hash tables instead of linear iptables rules.

## DNS resolution

CoreDNS provides the DNS component of service discovery. Every Service gets a DNS entry:

- `web.default.svc.cluster.local` (fully qualified)
- `web.default` (namespace-qualified)
- `web` (if the caller is in the same namespace)

For headless Services (used with StatefulSets), DNS returns individual pod IPs instead of the ClusterIP. For ExternalName Services, DNS returns a CNAME to an external hostname.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: external-api
spec:
  type: ExternalName
  externalName: api.example.com
```

When a pod resolves `external-api.default.svc.cluster.local`, it gets a CNAME to `api.example.com`. No traffic routing happens at the Kubernetes level; the pod talks directly to the external host. This is useful for providing a consistent internal name for an external dependency that might change.

## Practical debugging

When a Service isn't working, I check these things in order:

**1. Do the pods exist and are they Ready?**

```bash
kubectl get pods -l app=web
```

If pods are in CrashLoopBackOff or Pending, the Endpoints list will be empty.

**2. Do the Endpoints match?**

```bash
kubectl get endpoints web
```

If the Endpoints list is empty, the selector doesn't match any Ready pods. Check your labels.

**3. Can you reach the pod directly?**

```bash
kubectl exec debug-pod -- curl http://10.244.1.5:8080
```

If the pod IP works but the Service doesn't, the problem is in kube-proxy or iptables.

**4. Can you resolve the DNS name?**

```bash
kubectl exec debug-pod -- nslookup web.default.svc.cluster.local
```

If DNS doesn't resolve, check CoreDNS pods and logs.

**5. Is kube-proxy running?**

```bash
kubectl get pods -n kube-system -l k8s-app=kube-proxy
```

If kube-proxy is down on a node, Service routing won't work from that node.

This checklist has saved me more debugging time than any other sequence of commands. Most Service issues land in steps 1 or 2.



Kubernetes Service discovery is one of those things that works so well you forget it's there. You create a Service, pods come and go, DNS just resolves, and traffic arrives at healthy backends. The machinery underneath (Endpoints, kube-proxy, iptables, CoreDNS) is doing a lot of work to make that smoothness happen.

Understanding how it works under the hood doesn't make you better at writing YAML. It makes you better at debugging when the abstraction leaks. And it will leak, eventually. When it does, start with Endpoints and work outward.