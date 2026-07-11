---
title: "Linux file permissions explained"
slug: "linux-file-permissions-explained"
date: 2018-07-11
category: "Linux"
tags: ["linux", "permissions", "security", "basics"]
readingTime: "8 min read"
excerpt: "How Linux file permissions work, what chmod numbers actually mean, and when to use chown vs chgrp."
---

```
$ cat /etc/shadow
cat: /etc/shadow: Permission denied
```

You've seen this. Maybe you were trying to check a password hash, maybe you were just curious. Either way, Linux told you no. And if you're new to Linux, "Permission denied" is probably the error message you've seen most often.

It's not a bug. It's the system working correctly. Every file and directory on Linux has permissions that say who can read it, write it, or run it. Once you understand how that works, "Permission denied" stops being mysterious and starts being useful information.

<!-- truncate -->

## Reading permissions

Run `ls -l` on any file:

```bash
-rw-r--r-- 1 upi developers 4096 Mar 12 10:30 config.yaml
```

That first column is the permission string. Let's break it apart:

- `-` — file type. `-` is a regular file, `d` is a directory, `l` is a symlink
- `rw-` — what the owner can do (read and write)
- `r--` — what the group can do (read only)
- `r--` — what everyone else can do (read only)

Three sets of three characters. Owner, group, others. Read, write, execute. That's the whole model.

## The numeric shortcut

Each permission has a number: read is 4, write is 2, execute is 1. Add them up for each set:

- `rwx` = 4+2+1 = 7
- `rw-` = 4+2+0 = 6
- `r-x` = 4+0+1 = 5
- `r--` = 4+0+0 = 4

So `chmod 644 config.yaml` means the owner gets 6 (read+write), the group gets 4 (read), and others get 4 (read). Three digits, three sets.

Common ones you'll use constantly:

```bash
chmod 644 config.yaml   # rw-r--r--  — typical for config files
chmod 755 deploy.sh     # rwxr-xr-x  — scripts that anyone can run
chmod 600 id_rsa        # rw-------  — private key, owner only
chmod 700 ~/.ssh        # rwx------  — SSH directory, owner only
```

After a while these become second nature. 644 for files, 755 for scripts, 600 for secrets.

## Symbolic mode

The numeric way sets exact permissions. Symbolic mode is better for tweaking one bit:

```bash
chmod u+x deploy.sh     # add execute for the owner
chmod go-w config.yaml  # remove write for group and others
chmod a+r readme.txt    # add read for everyone (a = all)
```

`u` is user/owner, `g` is group, `o` is others, `a` is all. `+` adds, `-` removes, `=` sets exactly. I use numeric for setting permissions from scratch and symbolic for adjusting one thing.

## Directories are different

On a directory, execute means "can enter this directory." Without execute permission on a directory, you can't `cd` into it or access files inside, even if you know the exact filenames.

```bash
chmod 755 /home/upi/projects  # must have +x to traverse
```

Read without execute on a directory: you can list filenames but can't access them (no reading file contents, no getting file metadata). Execute without read: you can access files if you know their names, but `ls` won't show you what's in the directory.

This is weird at first but makes sense. Directory execute is about traversal, not about running something.

## Changing ownership

`chown` changes who owns a file. `chgrp` changes the group.

```bash
chown upi:developers config.yaml
chown -R upi:developers /opt/app/  # recursive — the whole tree
chgrp developers /opt/app/logs/
```

Only root can change file ownership. Any user can change the group of files they own, but only to groups they belong to. If you try `chgrp` to a group you're not in, you'll get "Operation not permitted."

The `-R` flag is important. `chown upi /opt/app` changes the top directory only. The files inside keep the old owner. This is a common source of "I changed the permissions but it still doesn't work."

## The sticky bit

You've probably noticed `/tmp` has a `t` at the end:

```bash
drwxrwxrwt 10 root root 4096 Mar 12 10:30 /tmp
```

The sticky bit means users can only delete their own files in that directory, even though the directory itself is world-writable. Without it, anyone could delete anyone else's temp files.

Set it with:

```bash
chmod +t /shared/uploads
# or numerically:
chmod 1777 /shared/uploads
```

Shared directories that need to be writable by multiple users should almost always have the sticky bit.

## setuid and setgid

setuid (numeric `4`) makes a file execute as its owner instead of the user who ran it. setgid (`2`) does the same for the group, or on a directory, makes new files inherit the directory's group.

```bash
chmod 4755 /usr/bin/passwd    # setuid — runs as root
chmod 2775 /opt/team/shared/  # setgid — new files get the team group
```

`passwd` needs setuid because it writes to `/etc/shadow`, which only root can access. That's one of the few legitimate uses. Be cautious with setuid on anything else, especially custom scripts. A setuid root script with a bug is a privilege escalation vulnerability.

## umask: default permissions for new files

When you create a file, its permissions come from the umask. The default umask is usually `022`, which means:

- Files: 666 - 022 = 644 (rw-r--r--)
- Directories: 777 - 022 = 755 (rwxr-xr-x)

Notice files start at 666, not 777. Linux doesn't give files execute by default, which makes sense. Most files aren't programs.

Check your current umask:

```bash
umask
```

For a shared system where you want stricter defaults:

```bash
umask 027  # files: 640, directories: 750
```

Put that in `/etc/profile` or `~/.bashrc` depending on whether you want it system-wide or per-user.

## What "Permission denied" is telling you

When you get "Permission denied," run `ls -l` on the file or directory. Look at the owner, the group, and the permissions. Figure out which set applies to you (are you the owner? in the group? neither?). Then you'll see exactly which permission is missing.

It's usually one of three things: you're not the owner and don't have group access, the file needs execute permission to run, or a directory in the path is missing execute so you can't traverse it.

Start restrictive (600 for private files, 755 for scripts) and open up only what you need. `chmod 777` fixes permission errors fast because it gives everyone full access. It also means any user on the system can read, modify, or delete those files. Figure out who actually needs access and grant it specifically. It takes a bit longer but you won't regret it.
