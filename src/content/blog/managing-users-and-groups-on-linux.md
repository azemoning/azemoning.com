---
title: "Managing users and groups on Linux"
slug: "managing-users-and-groups-on-linux"
date: 2019-04-22
category: "Linux"
tags: ["linux", "users", "groups", "administration"]
readingTime: "7 min read"
excerpt: "Adding, modifying, and removing users. How groups work and why /etc/passwd still matters."
---

A colleague of mine was setting up a new developer's account. He ran `usermod -G docker,staff newdev` to add the developer to the docker and staff groups. It worked. The developer was in both groups. The problem? The developer had previously been in the `sudo` group, and `usermod -G` without `-a` replaces all supplementary groups instead of adding to them. The developer lost sudo access. My colleague found out when the developer couldn't restart a service an hour later.

The fix was simple: `usermod -aG sudo newdev`. But it cost an hour of confusion and a slightly awkward conversation. The `-a` flag (append) is the difference between "add these groups" and "replace all groups with these groups." That one missing flag is probably the most common user management mistake on Linux.

<!-- truncate -->

## Creating users

Add a user:

```bash
useradd -m -s /bin/bash newuser
```

`-m` creates the home directory. `-s` sets the login shell. Without `-m`, the user gets no home directory, and then login fails in confusing ways. Without `-s`, the default shell might be `/bin/sh` or something else you don't want.

On Debian/Ubuntu, there's also `adduser`, a friendlier wrapper that prompts for a password and creates the home directory interactively:

```bash
adduser newuser
```

`adduser` is a Perl script that calls `useradd` under the hood. It's nicer for interactive use. In scripts, I use `useradd` directly because it's predictable.

Set or change a password:

```bash
passwd newuser
```

Lock an account without deleting it:

```bash
passwd -l newuser   # lock
passwd -u newuser   # unlock
```

Locking is useful for temporarily disabling access while keeping the account and its files intact.

## What's in /etc/passwd

Each line in `/etc/passwd` is one user:

```
newuser:x:1001:1001::/home/newuser:/bin/bash
```

Fields, separated by colons: username, password placeholder (x means the real hash is in `/etc/shadow`), UID, GID, GECOS (comment, usually empty), home directory, shell.

The actual password hash lives in `/etc/shadow`, which only root can read. If you ever see a password hash directly in `/etc/passwd` instead of an `x`, that's a security problem. It means passwords are stored without shadow protection.

## Groups

Every user has one primary group (set in `/etc/passwd`) and can belong to many supplementary groups. Groups control access to shared resources.

Create a group:

```bash
groupadd developers
```

Add a user to a group:

```bash
usermod -aG developers newuser
```

Remember: `-a` appends. Without it, you replace. I know I already mentioned this, but it's worth repeating because the consequences are immediate and annoying.

Check what groups someone belongs to:

```bash
groups newuser
# or, for more detail:
id newuser
```

`id` shows the UID, primary GID, and all supplementary groups. It's the quickest way to see the full picture.

## The sudo group

On Ubuntu, users in the `sudo` group can run commands as root:

```bash
usermod -aG sudo newuser
```

The sudoers file (`/etc/sudoers`) controls exactly what sudo can do. Always edit it with `visudo`, which checks syntax before saving. A malformed sudoers file can lock everyone out of root access, and then you need to boot into recovery mode to fix it. `visudo` prevents that.

You can also grant sudo for specific commands only:

```
newuser ALL=(ALL) /usr/bin/systemctl restart nginx
```

This lets the user restart nginx with sudo but nothing else. Useful for service accounts or junior team members.

## Modifying users

Change a user's shell:

```bash
usermod -s /bin/zsh newuser
```

Change their home directory:

```bash
usermod -d /home/newlocation -m newuser
```

The `-m` moves existing files to the new location. Without it, the user's home directory reference changes but the files stay in the old place.

Expire an account on a specific date:

```bash
usermod -e 2025-12-31 contractworker
```

After that date, the account is disabled. Good for contractors, temporary access, or anything time-limited.

## Deleting users

Remove a user:

```bash
userdel newuser
```

Remove the user and their home directory:

```bash
userdel -r newuser
```

Without `-r`, the home directory stays behind, owned by a UID that no longer maps to a username. You'll see numeric UIDs in `ls -l` output where there used to be a name. That's orphaned files. Sometimes you want to keep the data (archive it first), sometimes you want a clean removal. Just remember the flag.

## System accounts

Not every user is a person. nginx, postgres, redis, and other services each have their own accounts. These are created with low UIDs (below 1000) and `/usr/sbin/nologin` or `/bin/false` as their shell, so nobody can log in as them:

```bash
useradd -r -s /usr/sbin/nologin myservice
```

The `-r` flag creates a system account. You don't give system accounts passwords or login shells. They exist so processes can run under a dedicated identity with the right file permissions.

## Skeleton directory

When a new user is created, files from `/etc/skel/` are copied to their home directory. Put default `.bashrc`, `.profile`, `.vimrc`, or any other files you want every new user to start with. Customizing `/etc/skel/` is a small thing that saves time when you onboard people regularly.

## The human side

User management commands are simple. The mistakes happen when you rush: forgetting `-a` on `usermod -G`, deleting without `-r`, editing `/etc/passwd` by hand (use `vipw` if you must, it locks the file and checks syntax). When in doubt, `id username` and `groups username` show you the current state before you make changes. Check first, change second.
