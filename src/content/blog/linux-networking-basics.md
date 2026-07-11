---
title: "Linux networking basics: ip, ss, and troubleshooting"
slug: "linux-networking-basics"
date: 2018-08-17
category: "Linux"
tags: ["linux", "networking", "ip", "ss", "troubleshooting"]
readingTime: "8 min read"
excerpt: "Checking interfaces, routing, and connections with modern Linux networking tools. Replacing ifconfig and netstat."
---

"Can you ping it?"

That's the first question in every networking troubleshooting session, and for good reason. It's the fastest way to narrow down where a problem lives. If you can't ping a server, the problem is network-level. If you can ping it but can't reach the service, the problem is higher up. The whole diagnostic process is just asking increasingly specific versions of that same question.

<!-- truncate -->

But before we get to troubleshooting, you need to know the tools. The old ones (`ifconfig`, `netstat`, `route`) are being replaced by `ip` and `ss` from the `iproute2` package. The new tools are more powerful, but the syntax is different enough that people stick with what they know. Time to switch.

## ip: your new best friend

Show all interfaces and addresses:

```bash
ip addr show
# or shorter
ip a
```

The output is more verbose than `ifconfig`, but it's also more consistent. Look for the interface name, the `inet` line (IPv4), and `state UP` or `state DOWN`.

Show a specific interface:

```bash
ip addr show eth0
```

Add an address:

```bash
sudo ip addr add 192.168.1.100/24 dev eth0
```

Remove an address:

```bash
sudo ip addr del 192.168.1.100/24 dev eth0
```

Bring an interface up or down:

```bash
sudo ip link set eth0 up
sudo ip link set eth0 down
```

Link layer info (MAC addresses, state, MTU):

```bash
ip link show
```

One important thing: `ip addr` and `ip link` are different. `addr` shows IP addresses. `link` shows the lower-level interface state. You need both sometimes.

## Routing

The routing table tells the kernel where to send packets:

```bash
ip route show
```

Add a route:

```bash
sudo ip route add 10.0.0.0/8 via 192.168.1.1
```

Set the default gateway:

```bash
sudo ip route add default via 192.168.1.1
```

Delete a route:

```bash
sudo ip route del 10.0.0.0/8
```

Find which route a specific destination would take:

```bash
ip route get 8.8.8.8
```

This is useful for debugging. It tells you exactly which interface and gateway the kernel would use, without actually sending anything.

## ss: the socket inspector

`ss` replaces `netstat`. It's faster and more capable.

Show all listening TCP sockets with the process using them:

```bash
ss -tlnp
```

The flags: `-t` for TCP, `-l` for listening only, `-n` for numeric (skip DNS lookups), `-p` for process info.

Show all connections (not just listening):

```bash
ss -tanp
```

Filter by destination port:

```bash
ss -tanp dport = :80
```

Filter by source IP:

```bash
ss -tanp src 192.168.1.100
```

Count connections by state:

```bash
ss -tan | awk '{print $1}' | sort | uniq -c | sort -rn
```

This shows how many connections are ESTABLISHED, TIME_WAIT, CLOSE_WAIT, etc. I run this when a web server feels slow. A huge number of TIME_WAIT connections is usually a clue.

## DNS resolution

```bash
dig example.com
dig +short example.com       # just the IP
dig example.com MX           # MX records
nslookup example.com         # simpler, less featured
```

The system resolver config:

```bash
cat /etc/resolv.conf
```

On systemd-resolved systems (most modern Ubuntu), the resolver is actually at 127.0.0.53 and forwards to whatever DNS servers are configured. The real DNS servers are in `resolvectl status`.

## Connectivity testing

```bash
ping -c 4 8.8.8.8          # basic reachability
traceroute 8.8.8.8          # path taken
tracepath 8.8.8.8           # same idea, no root needed
```

## Making changes permanent

The `ip` commands above are temporary. They're gone after a reboot. For permanent configuration:

Ubuntu uses `/etc/network/interfaces`:

```
auto eth0
iface eth0 inet static
    address 192.168.1.100
    netmask 255.255.255.0
    gateway 192.168.1.1
    dns-nameservers 8.8.8.8 8.8.4.4
```

Newer Ubuntu (17.10+) uses Netplan:

```yaml
network:
  version: 2
  ethernets:
    eth0:
      addresses: [192.168.1.100/24]
      gateway4: 192.168.1.1
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]
```

## Network namespaces

Linux network namespaces isolate network stacks. Useful for testing:

```bash
sudo ip netns add test
sudo ip netns exec test ip addr show
sudo ip netns exec test ping 8.8.8.8
```

Connect namespaces with virtual ethernet pairs:

```bash
sudo ip link add veth0 type veth peer name veth1
sudo ip link set veth1 netns test
```

This is the foundation of container networking, by the way. Docker and Kubernetes use network namespaces under the hood.

## The troubleshooting sequence

When something can't connect, work through this:

1. `ping 127.0.0.1` — can you reach yourself? If not, the networking stack itself is broken
2. `ping <gateway>` — can you reach the local network? If not, interface or cable problem
3. `ping 8.8.8.8` — can you reach the internet? If not, routing or firewall problem
4. `dig example.com` — can you resolve DNS? If not, DNS config problem
5. `ss -tlnp | grep :80` — is the service actually listening?

Each step narrows the problem. If step 3 works but step 4 fails, you have a DNS issue, not a connectivity issue. This sequence has saved me hours of guessing.

## Watch out for these

**Using `ifconfig` on newer systems.** It might not be installed. `ip` is the replacement, and it's been the standard for years now.

**Forgetting the firewall.** A connection that times out might be blocked by iptables or nftables, not a networking issue at all. Check your firewall rules before blaming the network.

**Temporary changes that don't stick.** `ip addr add` works until reboot. If you meant it to be permanent, you need to edit the config files too.

**Confusing 127.0.0.53 with real DNS.** On systemd-resolved systems, `/etc/resolv.conf` points to a local stub. The actual servers are in `resolvectl status`.
