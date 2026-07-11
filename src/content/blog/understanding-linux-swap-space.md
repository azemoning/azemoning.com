---
title: "Understanding Linux swap space"
slug: "understanding-linux-swap-space"
date: 2022-01-06
category: "Linux"
tags: ["linux", "swap", "memory", "performance"]
readingTime: "6 min read"
excerpt: "What swap is, when Linux uses it, how much you need, and how to configure swap files and partitions."
---

"Swap is bad. Just add more RAM."

You've seen this on Reddit, probably in a thread where someone is asking why their server is slow. And it's... not wrong, exactly, but it's a bad summary. The real answer is more nuanced, and the "no swap ever" crowd is going to cause you problems if you listen to them without understanding why swap exists.

<!-- truncate -->

## What swap actually does

Swap is disk space the kernel uses as overflow for RAM. When memory gets tight, the kernel identifies pages that haven't been used recently and moves them to swap. If those pages are needed again, they get paged back in. The system stays running instead of killing processes.

Yes, disk is way slower than RAM. That's not the point. The point is that without swap, when you run out of memory, the OOM killer starts shooting processes. With swap, you get a buffer. Not a fast buffer, but a buffer.

## The swappiness parameter

This is where the Reddit crowd has a point: the default swappiness (60) is too high for most servers. It tells the kernel to swap more aggressively than necessary.

```bash
cat /proc/sys/vm/swappiness
```

Change it to 10 for a server that should prefer keeping things in RAM:

```bash
sudo sysctl vm.swappiness=10
```

Make it permanent in `/etc/sysctl.conf`:

```
vm.swappiness=10
```

Lower values mean "only swap when you really need to." The kernel still has the option, it just uses it less eagerly. I set this to 10 on every server I manage.

## How much swap you actually need

This depends on how much RAM you have. Guidelines that I've found work in practice:

- 1-4GB RAM: swap equal to RAM
- 4-16GB RAM: 2-4GB swap
- 16GB+ RAM: 2GB swap (sometimes less)
- VMs and containers: enough to handle spikes

The key insight: if your server is regularly hitting swap, it doesn't need more swap. It needs more RAM. Swap is a safety net, not a resource pool.

## Setting up a swap file

The modern approach (swap files instead of swap partitions):

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

The `chmod 600` matters. Swap files shouldn't be world-readable. `fallocate` creates the file instantly without writing zeros, which is why it's fast.

Add to `/etc/fstab` so it survives a reboot:

```
/swapfile none swap sw 0 0
```

(I've forgotten the fstab step more than once. You create swap, everything works, you reboot, swap is gone. Always add the fstab entry.)

## Checking what's happening

Three commands tell you everything:

```bash
free -h                  # total, used, and free swap alongside memory
swapon --show            # which devices/files are swap
cat /proc/swaps          # same info, different format
```

If you want to see swap activity in real time:

```bash
vmstat 1 5
```

The `si` (swap in) and `so` (swap out) columns show pages swapped per second. Both should be near zero on a healthy server. If they're consistently high, you have a memory problem that swap is masking.

## The "no swap" people

Running without swap means the OOM killer activates the moment RAM runs out. On a desktop, that might mean your browser gets killed. On a server, that might mean your database gets killed. A small swap (even 1GB) gives the system breathing room during memory spikes.

The counterargument is: "I'd rather fail fast than grind to a halt." That's valid for some workloads. But for most servers, a 2GB swap that never gets touched is better than a hard OOM kill at midnight.

The people running 32GB of swap on an 8GB server, though? They're doing it wrong. The system will become unresponsive long before it fills that swap, and instead of failing fast, it'll be useless for hours.

## Swap partitions vs swap files

Swap partitions were the traditional approach. Swap files are more flexible: create, resize, remove without repartitioning. For new setups, use swap files.

If you need a swap partition for some reason:

```bash
sudo fdisk /dev/sdb  # create partition, type 82
sudo mkswap /dev/sdb1
sudo swapon /dev/sdb1
```

## Disabling swap

```bash
sudo swapoff /swapfile
```

Or all swap:

```bash
sudo swapoff -a
```

To permanently remove: delete the file and remove the fstab entry.

## SSD swap

Swap on SSD works fine but adds wear. For servers where performance matters, the benefit usually outweighs the wear concern. SSDs are fast enough that swap thrashing is less painful than on spinning disks. But if you're thrashing swap on an SSD, the real fix is still more RAM.

## tmpfs and /dev/shm

`/dev/shm` is a tmpfs that lives in RAM. It counts toward memory usage but not swap. Some applications use it for shared memory. Worth knowing about if you see unexpected memory usage:

```bash
df -h /dev/shm
```

## The bottom line

Swap is a safety net, not a performance feature. Set swappiness low, configure a reasonable amount (2GB is fine for most servers), and monitor usage with `free -h`. If swap usage is consistently above zero, you have a memory problem to solve. Don't just throw more swap at it.

And ignore anyone who says "just add more RAM" as if budget, physical slots, and uptime requirements aren't real constraints. Swap exists for a reason.
