---
title: "Package management with apt"
slug: "package-management-with-apt"
date: 2020-05-14
category: "Linux"
tags: ["linux", "apt", "packages", "ubuntu", "debian"]
readingTime: "6 min read"
excerpt: "Installing, removing, and managing software packages on Ubuntu and Debian. Repositories, pins, and common gotchas."
---

You try to install something and get hit with a wall of text. 47 unsatisfied dependencies. Packages conflicting with other packages. Something about a held broken package. You run `apt install -f` and it wants to remove 200 packages including things you're pretty sure the system needs.

This is "dependency hell," and while apt handles it much better than the old days of `rpm` and manual dependency tracking, it still happens. Understanding how apt works under the hood means you spend less time in this pit.

<!-- truncate -->

## The basics

apt handles downloading, dependency resolution, installation, and removal of software packages. It's the front-end that most people interact with. There's also `dpkg`, which is the lower-level tool that does the actual installation.

Common operations:

```bash
sudo apt update                  # refresh package lists from repositories
sudo apt upgrade                 # upgrade all installed packages
sudo apt install nginx           # install a package
sudo apt remove nginx            # remove but keep config files
sudo apt purge nginx             # remove including config files
sudo apt autoremove              # remove dependencies no longer needed
```

The most common mistake I see: running `apt install` without running `apt update` first. If your package lists are stale, apt can't find packages that the repositories actually have. Always update first.

## apt vs apt-get

`apt` is the newer, user-friendly command. `apt-get` is the older one. The difference for daily use: `apt` has color output and progress bars. Use `apt` interactively, `apt-get` in scripts where output format stability matters (some scripts parse the output and break if it changes).

## Finding packages

```bash
apt search nginx                 # search by name or description
apt show nginx                   # package details, version, dependencies
apt list --installed             # what's installed
apt list --upgradable            # what has updates available
```

When you know a file exists but don't know which package provides it:

```bash
dpkg -S /usr/bin/curl
```

Or install `apt-file` for a broader search:

```bash
sudo apt install apt-file
sudo apt-file update
apt-file search /usr/bin/curl
```

## Repositories

Package sources are in `/etc/apt/sources.list` and `/etc/apt/sources.list.d/`.

A typical Ubuntu entry:

```
deb http://archive.ubuntu.com/ubuntu focal main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu focal-updates main restricted universe multiverse
deb http://security.ubuntu.com/ubuntu focal-security main restricted universe multiverse
```

The components:
- `main` , officially supported, free software
- `restricted` , officially supported, proprietary drivers
- `universe` , community-maintained, free software
- `multiverse` , non-free software with legal restrictions

When adding third-party repositories, make sure they match your Ubuntu version. Mixing repos from the wrong release is the fastest way to get dependency conflicts.

## PPAs

Personal Package Archives provide newer versions or third-party software:

```bash
sudo add-apt-repository ppa:ondrej/php
sudo apt update
sudo apt install php8.1
```

Remove a PPA:

```bash
sudo add-apt-repository --remove ppa:ondrej/php
```

PPAs are third-party repositories. They're maintained by individuals, not by Canonical. Trust them accordingly. I use the ondrej PHP PPA on every PHP server I manage, but I wouldn't add a random PPA just because a blog post recommended it.

## Adding a repo manually

For software that provides its own repository (Docker, Node.js, etc.):

```bash
curl -fsSL https://example.com/gpg.key | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/example.gpg
echo "deb https://repo.example.com/apt stable main" | sudo tee /etc/apt/sources.list.d/example.list
sudo apt update
```

The GPG key tells apt to trust packages signed by that repository. Without it, apt will refuse to install.

## Holding packages at a specific version

Sometimes you need a specific version and don't want automatic updates to change it:

```bash
sudo apt-mark hold nginx
```

Release the hold:

```bash
sudo apt-mark unhold nginx
```

Check what's held:

```bash
apt-mark showhold
```

## Version pinning

Install a specific version:

```bash
apt show -a nginx                # list available versions
sudo apt install nginx=1.18.0-0ubuntu1
```

For more control, create preferences in `/etc/apt/preferences.d/`:

```
Package: nginx
Pin: version 1.18*
Pin-Priority: 1001
```

Priority above 1000 forces downgrades. Below 1000 prevents upgrades. The details get complicated, but the basic idea is: higher priority wins.

## dpkg: the low-level tool

dpkg handles individual `.deb` files without dependency resolution:

```bash
sudo dpkg -i package.deb     # install (may fail if dependencies are missing)
sudo apt install -f           # fix broken dependencies
sudo dpkg -r package          # remove
sudo dpkg -l                  # list installed packages
```

`dpkg -i` followed by `apt install -f` is a common pattern. You install the local file, then let apt resolve the missing dependencies. It's clunky but it works.

## Cleaning up

Over time, the package cache fills up:

```bash
sudo apt clean                 # remove all cached .deb files
sudo apt autoclean             # remove only outdated cached packages
sudo apt autoremove            # remove dependencies no longer needed
```

Check how much space the cache is using:

```bash
du -sh /var/cache/apt/archives/
```

On servers that get regular updates, this can grow to several gigabytes. `apt clean` gets it back.

## Version conflicts

When apt reports conflicts, the usual causes:

**Mixing repositories for different Ubuntu versions.** If you're on 22.04 and added a repo meant for 20.04, packages from that repo might conflict with system packages. Match the repo to your release.

**Third-party packages that conflict with system packages.** Some software (especially database servers and language runtimes) replaces system packages with their own versions. This works until it doesn't.

**Held packages preventing upgrades.** Check `apt-mark showhold`. Sometimes a package is held and you forgot about it.

The fix usually involves either removing the conflicting repo, forcing a specific version, or occasionally `sudo apt install -f` to untangle things. When that fails, `dpkg --configure -a` and `apt install -f` in sequence often helps.
