---
title: "Understanding the Linux filesystem hierarchy"
slug: "understanding-the-linux-filesystem-hierarchy"
date: 2022-02-25
category: "Linux"
tags: ["linux", "filesystem", "fhs", "basics"]
readingTime: "6 min read"
excerpt: "Where things live on a Linux system and why. A practical guide to the directory layout."
---

Why is `/bin` a symlink to `/usr/bin`?

I remember staring at that on an Ubuntu 16.04 box and thinking something was broken. Turns out nothing was broken. The "usrmerge" happened, and it's actually a sensible change once you understand what these directories were supposed to mean in the first place.

<!-- truncate -->

That question sent me down a rabbit hole about the filesystem hierarchy, and I think the best way to explain it is to walk through the tree like I'm giving a tour.

## Starting at the root

`/` is the top. Everything is a subtree of this single directory. That's not a metaphor, it's literally how Unix works.

## Where the executables live

**`/bin`** holds the commands everyone needs: `ls`, `cp`, `mv`, `cat`, `grep`. These have to be available early in the boot process, even before other filesystems are mounted. That's why they're separate from `/usr` historically.

On modern Ubuntu and Debian, `/bin` is just a symlink to `/usr/bin`. Same files, one location. The merge happened because there was no practical reason to keep them separate anymore. (If you're curious, the Fedora world did this years earlier.)

**`/sbin`** is the same idea but for system administration commands. `fdisk`, `ifconfig`, `reboot`. Mostly root-only tools. Also merged into `/usr/sbin` on modern systems.

## Configuration and users

**`/etc`** is where system configuration goes. `passwd`, `fstab`, `hostname`, the `ssh/` directory. When someone says "check the config," they mean `/etc`. Period. I've never seen a situation where that wasn't the answer.

**`/home`** contains user directories. `/home/upi`, `/home/otheruser`. Each user gets a space for personal files, dotfiles, their `.bashrc`, whatever.

**`/root`** is root's home, and it lives at `/root` instead of `/home/root`. This is deliberate: if `/home` is on a separate filesystem that fails to mount, root still has a working home directory. Think of it as a safety measure.

## Variable and temporary data

**`/var`** is for things that change during normal operation. Logs in `/var/log`, mail in `/var/mail`, caches in `/var/cache`. The name "variable" is accurate here.

**`/tmp`** gets cleared on reboot (on most distributions). It's world-writable with the sticky bit set, meaning anyone can create files but can only delete their own. Don't put anything important here.

There's also `/var/tmp`, which usually survives reboots. The distinction matters: `/tmp` for throwaway stuff, `/var/tmp` for temporary files you need to keep around for a while.

## The /usr hierarchy

**`/usr`** is the big one. It's the "secondary hierarchy" for user programs, and on modern systems it's where most things actually live:

- `/usr/bin` , user commands
- `/usr/sbin` , system commands
- `/usr/lib` , libraries
- `/usr/share` , architecture-independent data (man pages, icons, docs)
- `/usr/local` , software you install yourself (not from the package manager)

If you compile something from source, it goes in `/usr/local/bin`. That keeps it separate from package-managed binaries.

## Device and kernel interfaces

**`/proc`** is a virtual filesystem. None of those files exist on disk. The kernel generates them on the fly. `cat /proc/cpuinfo` gives you CPU details. `cat /proc/meminfo` shows memory stats. Process information lives at `/proc/<pid>/`.

**`/sys`** is another virtual filesystem, more structured than `/proc`. It's where tools like `udev` read device and kernel information.

**`/dev`** holds device files. `/dev/sda` is your first disk. `/dev/null` is the black hole that eats everything you write to it. `/dev/zero` gives you zeros. You'll use these more than you think.

## Everything else

**`/opt`** is for optional software that doesn't follow the standard layout. Third-party applications often install here as `/opt/company-name/app/`. If you're packaging something yourself and it doesn't fit the usual structure, `/opt` is where it goes.

**`/boot`** contains kernel images and bootloader files. The `vmlinuz` files, initramfs, GRUB config. Don't touch this directory unless you know exactly what you're doing. (I've bricked a boot process before. It's not fun.)

**`/mnt`** and **`/media`** are mount points. `/mnt` is for temporary mounts like NFS shares. `/media` is for removable media like USB drives.

## The log directory

`/var/log` deserves its own mention because you'll be in it constantly:

- `/var/log/syslog` , main system log on Debian/Ubuntu
- `/var/log/auth.log` , authentication attempts (every SSH login, every sudo)
- `/var/log/kern.log` , kernel messages
- `/var/log/dmesg` , boot-time hardware messages
- `/var/log/apt/` , package manager history

## Where to put stuff

When you're not sure where something belongs, think about what category it falls into:

| What | Where |
|------|-------|
| App config | `/etc/appname/` |
| Binaries you compiled | `/usr/local/bin/` |
| Service data (databases, state) | `/var/lib/appname/` |
| Logs | `/var/log/appname/` |
| Automation scripts | `/usr/local/sbin/` or `/opt/scripts/` |

The directory layout makes sense when you think of it as a filing system: configuration in `/etc`, variable data in `/var`, user programs in `/usr`, temporary stuff in `/tmp`. When you can't find something, asking "what category is this?" usually points you to the right place.

One more thing: don't put application data in `/home`. Home directories are for users, not for services. I've seen this go wrong more times than I'd like to admit, usually when someone installs something manually and just dumps it wherever they happen to be logged in.
