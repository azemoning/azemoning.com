---
title: "Managing services with systemd"
slug: "managing-services-with-systemd"
date: 2019-03-24
category: "Linux"
tags: ["linux", "systemd", "services", "administration"]
readingTime: "8 min read"
excerpt: "Starting, stopping, and debugging services with systemctl. Writing basic unit files and understanding targets."
---

Systemd is fine, actually.

I know that's a controversial take in some circles. Systemd replaced Upstart, which replaced SysV init, and each transition came with complaints. Systemd is too complex, they said. It does too much, it violates the Unix philosophy, it's a single point of failure.

Some of those criticisms have merit. Systemd does a lot: it manages services, handles logging, manages mounts, sets up networks, controls logins, and runs timers. That's more than an init system "should" do, if you believe init systems should be small and focused.

But here's the thing: it works. Every day. On every major Linux distribution. The unit file format is readable, `systemctl` is consistent, and `journalctl` beats the old approach of digging through scattered log files in `/var/log/`. I've used SysV init scripts (those `/etc/init.d/` shell scripts with case statements and pidfiles). Systemd is better. Not perfect, but better.

<!-- truncate -->

## The basics: systemctl

Check a service:

```bash
sudo systemctl status nginx
```

This shows whether it's running, the PID, memory usage, and the last few log lines. It's the first thing I run when something seems wrong.

Start, stop, restart:

```bash
sudo systemctl start nginx
sudo systemctl stop nginx
sudo systemctl restart nginx
```

`reload` is gentler than `restart`. It tells the service to reread its configuration without dropping connections, if the service supports it:

```bash
sudo systemctl reload nginx
```

nginx supports reload. Not all services do. If reload doesn't work for a service, it usually just does nothing or returns an error.

Enable at boot:

```bash
sudo systemctl enable nginx
sudo systemctl disable nginx
systemctl is-enabled nginx
```

"Enabled" means the service starts automatically at boot. A service can be enabled but not currently running, or running but not enabled. These are independent states.

## Writing a unit file

Custom services get unit files in `/etc/systemd/system/`. Here's a basic one for a Node.js application:

```ini
[Unit]
Description=My Node.js Application
After=network.target

[Service]
Type=simple
User=appuser
WorkingDirectory=/opt/myapp
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`After=network.target` means start after the network is up. `User=appuser` runs it as a regular user, not root. `Restart=on-failure` restarts the process if it crashes. `RestartSec=5` waits 5 seconds before restarting (avoids crash loops hammering the system).

After creating or editing a unit file:

```bash
sudo systemctl daemon-reload
sudo systemctl start myapp
sudo systemctl enable myapp
```

`daemon-reload` is the step everyone forgets. Systemd caches unit files, so your edits don't take effect until you reload. You'll change a unit file, restart the service, and nothing will change, and you'll stare at it for 10 minutes wondering why. Run daemon-reload.

## Service types

`Type=simple` (the default) means the process started by ExecStart is the main process. It's expected to stay in the foreground.

`Type=forking` is for traditional daemons that fork into the background and return. You need to specify `PIDFile=` so systemd can track the main process.

`Type=oneshot` is for tasks that run and exit. The service is considered "started" once the process finishes. Use `RemainAfterExit=yes` if the service should be considered "active" even after the process exits (useful for setup tasks that only need to run once per boot).

`Type=notify` is for services that send a readiness signal to systemd when they're fully started. This is better than `Type=simple` for services that take time to initialize because systemd won't mark them as "started" until they're actually ready.

## Logs with journalctl

This is where systemd genuinely improves on the old way. Instead of scattered log files, everything goes to the journal:

```bash
journalctl -u nginx                  # all logs for nginx
journalctl -u nginx -f               # follow in real time
journalctl -u nginx --since today    # today only
journalctl -u nginx --since "2024-01-15" --until "2024-01-16"
```

The journal is persistent if `/var/log/journal/` exists. If it doesn't, logs are in memory only and lost on reboot. To make them persistent:

```bash
sudo mkdir -p /var/log/journal
sudo systemd-tmpfiles --create --prefix /var/log/journal
```

You can also filter by priority:

```bash
journalctl -u nginx -p err    # errors and above
journalctl -u nginx -p warning # warnings and above
```

And see logs from the previous boot (useful after a crash):

```bash
journalctl -b -1 -u nginx    # logs from one boot ago
```

## Targets

Targets group services together. They're the systemd version of runlevels:

```bash
systemctl get-default                           # current default target
sudo systemctl set-default multi-user.target    # text mode (servers)
sudo systemctl set-default graphical.target     # graphical mode (desktops)
```

`multi-user.target` is what servers use. If you're running a desktop, you want `graphical.target`. On a server, graphical.target wastes resources on a desktop environment nobody will see.

## Dependencies

`After=` and `Before=` control startup order. `Requires=` and `Wants=` control dependencies:

```ini
[Unit]
Description=My App
After=postgresql.service
Requires=postgresql.service
```

`Requires=` means if postgresql fails to start, my app fails too. `Wants=` is softer: it tries to start the dependency but continues if it can't. Use `Requires=` when the dependency is truly mandatory. Use `Wants=` for optional dependencies.

## Resource limits

Keep a runaway service from eating the whole server:

```ini
[Service]
MemoryLimit=512M
CPUQuota=50%
```

This is simple but effective. A service that starts leaking memory will hit 512M and get killed (or throttled, depending on the version of systemd). A buggy service that starts a CPU-spinning loop is capped at 50% of one core.

For more granular control, there's `MemoryMax=`, `MemoryHigh=`, `CPUWeight=`, and `IOWeight=` in newer versions of systemd.

## The practical stuff

When a service won't start, the answer is almost always in the output of `systemctl status` or `journalctl -u`. Read it. The error message tells you what's wrong: missing config, port already in use, wrong permissions, missing dependency.

The unit file format is readable. You can look at any unit file on the system and understand what it does:

```bash
systemctl cat nginx    # show the unit file for nginx
```

And you can see what depends on a service:

```bash
systemctl list-dependencies nginx
```

Systemd is a tool. It has rough edges (the documentation is spread across too many man pages, some commands are inconsistent, the journal can be slow on very large logs). But the fundamentals are solid: start services, manage dependencies, collect logs, restart on failure. It does what an init system should do, and it does it reliably.
