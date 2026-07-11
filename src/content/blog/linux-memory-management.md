---
title: "Linux memory management: free, vmstat, and /proc"
slug: "linux-memory-management"
date: 2018-07-29
category: "Linux"
tags: ["linux", "memory", "monitoring", "troubleshooting", "performance"]
readingTime: "7 min read"
excerpt: "Understanding how Linux uses memory. Reading free correctly, using vmstat, and what /proc/meminfo actually tells you."
---

Your monitoring system fires an alert: server memory at 95%. You SSH in, run `free -h`, and panic. Only 800MB free out of 16GB. Something is eating all the RAM.

<!-- truncate -->

Probably not. Linux is doing exactly what it's supposed to do.

Linux treats unused RAM as wasted RAM. When processes finish with memory, the kernel doesn't immediately release it. It keeps file data cached in case something needs the same files again. This cache is counted as "used" in most monitoring tools, but the kernel can drop it in microseconds when a process actually needs the memory.

The number you care about is `available`, not `free`. Let me show you what I mean.

## Reading `free` correctly

```bash
free -h
```

Output:

```
              total        used        free      shared  buff/cache   available
Mem:           15Gi       8.2Gi       1.1Gi       256Mi       6.1Gi       6.5Gi
Swap:         2.0Gi       0.0Gi       2.0Gi
```

Here's what each column means:

- **total**: Physical RAM installed
- **used**: Memory actively held by processes
- **free**: RAM doing absolutely nothing (this is the number that scares people)
- **buff/cache**: File data cached in memory by the kernel
- **available**: Memory actually available for new processes (free + reclaimable cache)

That 1.1Gi "free" looks terrible. But 6.5Gi is "available", meaning the kernel can hand out 6.5GB to new processes by dropping cache. The 6.1Gi in cache is just the kernel being efficient: it's holding onto file data so repeated reads hit RAM instead of disk.

**Bottom line:** if `available` is comfortably above what your applications need, you're fine. Don't look at `free`.

## How the page cache works

When you read `/var/log/syslog`, the kernel loads the file contents into RAM. The next time something reads the same file, it serves it from cache. This is orders of magnitude faster than reading from disk.

Check how much memory is used for cache:

```bash
vmstat -s | grep cache
```

On a server that's been running for a while, cache is usually the largest consumer of memory. That's healthy. It means the kernel is reusing memory efficiently instead of letting it sit idle.

When a process needs memory, the kernel drops the least recently used cache pages. This happens instantly, no performance penalty. It's only a problem if the system is under such extreme memory pressure that it's constantly dropping and re-reading the same files (thrashing).

## vmstat: watching memory in real time

`free` gives you a snapshot. `vmstat` shows you trends:

```bash
vmstat 1 5
```

Output:

```
procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
 r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
 1  0  24576 452864 234560 6144000   0    0    12    45  234  567 12  3 84  1  0
```

The memory columns (in KB) show swpd (swap used), free, buff, and cache.

The important ones for diagnosing problems:

- **si** (swap in): Pages read from swap back into RAM
- **so** (swap out): Pages written from RAM to swap

If `si` and `so` are consistently above zero, you're swapping. A little swap activity is fine. Sustained swapping means you need more RAM or your processes are using too much memory.

- **wa** (I/O wait): Percentage of time the CPU is waiting for disk I/O
- **st** (stolen): VM only. Time the hypervisor took away from your VM to give to another one.

High `wa` means the system is disk-bound (possibly from swapping). High `st` means the host is overcommitted. Neither is a memory problem per se, but both affect performance.

## /proc/meminfo: the raw data

`free` reads from `/proc/meminfo`. You can go straight to the source:

```bash
cat /proc/meminfo
```

Useful fields:

- `MemAvailable`: What `free` shows as "available"
- `Dirty`: Memory modified but not yet written to disk
- `Slab`: Kernel data structures (inodes, dentries, network buffers)
- `Committed_AS`: Total memory the kernel has promised to processes (can exceed physical RAM with overcommit)

## Per-process memory

Find the memory hogs:

```bash
ps aux --sort=-%mem | head -10
```

More detail per process:

```bash
cat /proc/PID/status | grep -i mem
```

- `VmRSS`: Actual physical memory used (what matters)
- `VmSize`: Virtual address space (includes shared libraries, memory-mapped files, and a lot of things that aren't actually using RAM)

VmSize is misleading. A Java process might show 2GB of VmSize but only 500MB of RSS. Don't use VmSize to judge memory usage.

For a cleaner per-process view:

```bash
sudo smem -tk
```

(`sudo apt install smem` if you don't have it.)

## The OOM killer

When the system runs out of memory, including swap, the kernel invokes the OOM killer. It picks a process (usually the one using the most memory) and kills it. This is a last resort, and it's ugly: the process dies immediately, no cleanup.

Check for OOM events:

```bash
dmesg | grep -i "out of memory"
journalctl -k | grep -i "oom"
```

Protect critical processes from OOM:

```bash
echo -1000 > /proc/PID/oom_score_adj
```

Or in a systemd service:

```ini
[Service]
OOMScoreAdjust=-1000
```

Make a process more likely to be killed (sacrificial lamb):

```bash
echo 1000 > /proc/PID/oom_score_adj
```

## Cgroup memory limits

Limit memory per service with systemd:

```ini
[Service]
MemoryMax=512M
MemoryHigh=400M
```

`MemoryHigh` throttles the process when it exceeds the limit (it gets less memory, but isn't killed). `MemoryMax` is a hard ceiling. Exceed it and the OOM killer activates.

Useful for preventing one service from starving everything else. I set these on most production services.

## What to actually monitor

Alert on `available` dropping below a threshold (say, 10% of total RAM). Don't alert on `free` being low. It's supposed to be low.

Watch swap usage. A little swap is fine. Consistent heavy swapping means you're out of physical RAM.

Monitor RSS of critical processes over time. Memory leaks show up as gradually increasing RSS, not as sudden spikes.

Check `dmesg` or `journalctl` for OOM events. If the OOM killer has been active, you have a real problem.

The short version: Linux uses memory aggressively for caching. That's good. Low `free` is normal. Check `available`. Monitor swap. Set cgroup limits on services. And stop panicking at 95% memory usage unless `available` is actually low.
