---
title: "Time synchronization with NTP"
slug: "time-synchronization-with-ntp"
date: 2021-05-17
category: "Linux"
tags: ["linux", "ntp", "time", "chrony", "systemd"]
readingTime: "5 min read"
excerpt: "Keeping Linux clocks accurate with chrony and systemd-timesyncd. Why time matters and how to configure it."
---

A few years back I spent the better part of a morning chasing a TLS error on a production API. Clients were getting certificate validation failures, but the cert was valid. Not expired, correct domain, chain intact. I checked everything twice. Then I noticed the server's clock was 10 minutes ahead.

<!-- truncate -->

That was it. Ten minutes. The TLS handshake thought the certificate wasn't valid yet because the server was living in the future. A `timedatectl set-ntp true` and 30 seconds later, everything worked.

That's when I started paying attention to time synchronization.

## Why your clock drifts

Every computer has a hardware clock (RTC) that ticks when the machine is off. When Linux boots, it reads that clock and sets the system time. The problem is that hardware clocks are cheap crystals. They drift. A few milliseconds per day adds up. Virtual machines are worse: they share CPU time with other VMs, and clock interrupts get delayed. A VM can drift several seconds per day without correction.

## The tools

There are two NTP clients you'll encounter on modern Linux: chrony and systemd-timesyncd. Both sync your clock over the network. Don't run both at the same time.

### chrony

chrony is the better choice for servers. It's faster at correcting large offsets, handles intermittent network connectivity well, and can serve as an NTP server for other machines.

Ubuntu 16.04+ ships with chrony. Check if it's running:

```bash
systemctl status chrony
```

See where it's getting time from:

```bash
chronyc sources -v
```

You'll see a list of NTP servers. A `*` next to one means it's the current preferred source. `+` means acceptable. `-` means rejected (usually because the round-trip time is too high).

Check the current offset:

```bash
chronyc tracking
```

The "System time" line tells you how far off you are. A few milliseconds is normal. If it's showing seconds, something is wrong.

Configuration is in `/etc/chrony/chrony.conf`. The defaults usually work:

```
server 0.pool.ntp.org iburst
server 1.pool.ntp.org iburst
server 2.pool.ntp.org iburst
server 3.pool.ntp.org iburst
```

`iburst` sends a burst of packets on initial sync so chrony gets accurate time faster after startup.

If your clock is way off and chrony isn't correcting it (it tries to slew rather than step for large offsets):

```bash
sudo chronyc makestep
```

This forces an immediate step to the correct time.

### systemd-timesyncd

Simpler, lighter, built into systemd. It only syncs time (doesn't serve other clients). Good for desktops and simple servers.

```bash
timedatectl status
```

This shows current time, timezone, and whether NTP sync is active.

To configure which servers it uses, edit `/etc/systemd/timesyncd.conf`:

```ini
[Time]
NTP=0.pool.ntp.org 1.pool.ntp.org
```

Enable and restart:

```bash
sudo systemctl enable systemd-timesyncd
sudo systemctl restart systemd-timesyncd
```

### Which one to pick

chrony if you need accurate time (databases, financial systems, logging across clusters). It compensates for network jitter better and corrects drift faster.

systemd-timesyncd if you just want "close enough" and prefer one less daemon to manage.

Either way, check that it's actually working after you set it up. `chronyc tracking` or `timedatectl status`. Don't assume.

## Setting the timezone

UTC is the standard for servers. Every log, every cron job, every timestamp in your application should be UTC. Convert to local time in the display layer.

```bash
timedatectl set-timezone UTC
```

If you need a different timezone (maybe your cron jobs are specified in local time for business reasons):

```bash
timedatectl list-timezones | grep Asia
sudo timedatectl set-timezone Asia/Jakarta
```

## The hardware clock

When the system shuts down, it writes the current time to the hardware clock. When it boots, it reads it back. If the hardware clock is wrong, your system starts with wrong time and has to wait for NTP to fix it.

Sync the hardware clock to your (correct) system time:

```bash
sudo hwclock --systohc
```

Check what the hardware clock thinks:

```bash
sudo hwclock --show
```

## When things go wrong

**Time keeps drifting even with NTP running.** Usually a VM problem. The host is overcommitted and clock interrupts are getting delayed. chrony handles this better than ntpd, but if the drift is severe, talk to your hosting provider about enabling NTP at the hypervisor level.

**chrony won't step to the correct time.** By default, chrony slews (gradually adjusts) rather than steps (jumps). For offsets over a few seconds, use `chronyc makestep`.

**NTP packets are blocked.** Your firewall or cloud security group might be blocking UDP port 123. Check with `ntpdate -q 0.pool.ntp.org`. If it times out, that's your problem.

**Both chrony and timesyncd are running.** Pick one. `systemctl stop` and `systemctl disable` the one you don't want. Running both causes conflicts and unpredictable behavior.

## Checking from the command line

Quick health check:

```bash
timedatectl          # is NTP enabled?
chronyc tracking     # what's the offset?
chronyc sources      # which servers am I using?
```

If you just want to check time against a specific server:

```bash
ntpdate -q 0.pool.ntp.org
```

This queries the server and shows the offset without actually changing your clock. Useful for testing connectivity.

Time synchronization is one of those things that works silently until it doesn't, and when it fails, the symptoms are weird. Cryptographic errors. Log timestamps that don't line up. Replication conflicts. If you're debugging something that doesn't make sense, check the clock. It takes five seconds and rules out a surprising number of problems.
