---
title: "Tuning Linux kernel parameters with sysctl"
slug: "tuning-linux-kernel-parameters-with-sysctl"
date: 2021-10-17
category: "Linux"
tags: ["linux", "sysctl", "kernel", "performance", "tuning"]
readingTime: "7 min read"
excerpt: "Runtime kernel tuning with sysctl. Network performance, memory management, and security hardening parameters."
---

Your server handles 50,000 concurrent connections without breaking a sweat. Traffic spikes to 500,000 and it falls over. You throw more RAM at it, more CPU, maybe even more servers. Nothing helps. The bottleneck isn't your application. It's the kernel.

<!-- truncate -->

That's usually when people discover sysctl. The Linux kernel has hundreds of tunable parameters that control how it handles networking, memory, and security. The defaults are conservative, designed to work on everything from a Raspberry Pi to a beefy rack server. For a specific workload, they're often wrong.

## How sysctl works

The kernel exposes its parameters as files under `/proc/sys/`. You can read them directly:

```bash
cat /proc/sys/net/ipv4/ip_forward
```

Or use the `sysctl` command, which is a bit more convenient:

```bash
sysctl net.ipv4.ip_forward
```

To see everything (there are hundreds):

```bash
sysctl -a
```

Setting a value temporarily (gone after reboot):

```bash
sudo sysctl -w net.ipv4.ip_forward=1
```

For permanent changes, edit `/etc/sysctl.conf` or drop a file in `/etc/sysctl.d/`:

```bash
sudo nano /etc/sysctl.d/99-tuning.conf
```

Then apply:

```bash
sudo sysctl --system
```

I prefer `/etc/sysctl.d/` over editing `sysctl.conf` directly. Keeps my changes separate from whatever the distro ships. Name the file something like `99-tuning.conf` so it loads last and overrides earlier values.

## The parameters that actually matter

Here's what I end up changing on most servers. Not all of these apply to every situation. Read the comments, understand what they do, then decide.

### Network performance

Connection tracking is the first thing that bites you at scale. The default table is small:

```
net.netfilter.nf_conntrack_max = 262144
net.netfilter.nf_conntrack_tcp_timeout_established = 600
```

If you're running a firewall (you are), every connection goes through the conntrack table. Exhaust it and new connections get dropped silently. The timeout matters too: 5 days is the default for established connections. If your connections are short-lived (HTTP API traffic), 600 seconds is plenty.

Socket buffers for high-bandwidth links:

```
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
```

These control how much memory the kernel allocates for TCP send/receive buffers. The defaults are tuned for 2010-era network speeds. On a 10Gbps link, you need bigger buffers or TCP can't fill the pipe.

More useful network tweaks:

```
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 30
```

`ip_local_port_range` gives you more ephemeral ports (useful when your app makes lots of outbound connections). `tcp_fastopen` saves a round-trip on new TCP connections. `tcp_tw_reuse` and `tcp_fin_timeout` help with TIME_WAIT buildup on busy load balancers.

If your machine routes packets (gateway, VPN server, container host):

```
net.ipv4.ip_forward = 1
```

### Memory

Swap aggressiveness:

```
vm.swappiness = 10
```

The default is 60, which means the kernel eagerly swaps out process memory to make room for cache. Setting it to 10 keeps processes in RAM longer. For database servers, I sometimes set it to 1. (Setting it to 0 used to mean "never swap" but that changed in newer kernels.)

Cache pressure:

```
vm.vfs_cache_pressure = 50
```

The kernel caches directory and inode entries. Default is 100, meaning it reclaims them at the same rate as other cache. Setting it lower keeps filesystem metadata cached longer. Helps on servers that stat lots of files.

For Redis, Elasticsearch, or anything that uses `mmap` heavily:

```
vm.overcommit_memory = 1
vm.max_map_count = 262144
```

`overcommit_memory = 1` tells the kernel to always allow memory allocation and deal with shortages later (via OOM killer). Redis forks for background saves, and without this, the fork fails because the kernel won't overcommit.

### Security hardening

These should be on every internet-facing server:

```
net.ipv4.conf.all.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.conf.all.rp_filter = 1
```

SYN cookies protect against SYN flood attacks without needing a huge backlog queue. Reverse path filtering drops packets with spoofed source addresses. Disabling redirects and source routing closes off some older attack vectors.

## Putting it together

I usually create two config files per server: one for hardening (ships with every server) and one for performance (tuned per workload).

```bash
sudo nano /etc/sysctl.d/10-hardening.conf
sudo nano /etc/sysctl.d/90-performance.conf
```

Apply everything:

```bash
sudo sysctl --system
```

Verify a specific value took effect:

```bash
sysctl net.ipv4.tcp_tw_reuse
```

## Gotchas

A few things that have bitten me:

sysctl silently ignores unknown parameter names in config files. If you typo `net.ipv4.tcp_syncookes`, it just skips it. Run `sudo sysctl --system` and watch for warnings.

Parameters vary between kernel versions. Something that works on Ubuntu 20.04 might not exist on 22.04. Check with `sysctl -a | grep <name>` before relying on a parameter.

Editing `/proc/sys/` directly works but the change is lost on reboot. Use sysctl.

Some parameters need the `conntrack` module loaded before they're available. If `net.netfilter.nf_conntrack_max` doesn't exist, `modprobe nf_conntrack` first.

## Is tuning worth it?

For most servers, the defaults are fine. Really. Don't tune parameters because a blog post (including this one) told you to. Tune them because you hit a specific limit and measured the improvement.

That said, the security hardening parameters are worth applying everywhere. There's no performance cost and they close real attack vectors. For network performance, start with conntrack and socket buffers. Those are the parameters that matter most at scale.

Document every change. Six months from now, you won't remember why you set `vm.vfs_cache_pressure = 50`. A comment in the config file saves you from that conversation with yourself.
