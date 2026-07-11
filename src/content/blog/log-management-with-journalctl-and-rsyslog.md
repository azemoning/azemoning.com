---
title: "Log management with journalctl and rsyslog"
slug: "log-management-with-journalctl-and-rsyslog"
date: 2019-02-12
category: "Linux"
tags: ["linux", "logging", "journalctl", "rsyslog", "troubleshooting"]
readingTime: "7 min read"
excerpt: "Reading systemd logs with journalctl, configuring rsyslog for remote logging, and managing log rotation."
---

You just SSHed into a server with a problem. The application is returning 500 errors. You check `/var/log/syslog` and... nothing relevant. You check the application log directory and it's empty. You check `dmesg` and get hardware messages from boot. Where are the logs?

If this has happened to you, it's because Linux has two logging systems running at the same time, and the application might be sending logs to one but not the other.

<!-- truncate -->

## The two logging systems

**journald** is systemd's binary log. It stores structured data with metadata (PID, UID, boot ID, timestamps). You query it with `journalctl`.

**rsyslog** is the traditional text-based logger. It writes plain text files in `/var/log/`. You query it with `grep`.

Most systems run both. Some services log to journald only, some to rsyslog only, some to both. When you can't find a log, check the other system.

## journalctl: structured log queries

The basic commands:

```bash
journalctl                      # everything (opens a pager)
journalctl -f                   # follow in real time, like tail -f
journalctl -u nginx             # just nginx
journalctl -u nginx -u php-fpm  # multiple services
```

Time filtering is where journalctl gets useful:

```bash
journalctl --since today
journalctl --since "2024-01-15 10:00:00"
journalctl --since "1 hour ago"
journalctl --since yesterday --until today
```

Filter by severity:

```bash
journalctl -p err          # errors and above
journalctl -p warning      # warnings and above
```

The priority levels, from most to least severe: emerg, alert, crit, err, warning, notice, info, debug.

Combine filters (they're ANDed):

```bash
journalctl -u nginx -p err --since today
```

That gives you nginx errors from today. Way faster than grepping through a text file.

## Metadata filtering

Because journald is structured, you can filter by things rsyslog can't easily express:

```bash
journalctl _PID=1234            # specific process
journalctl _UID=1000            # specific user
journalctl -b -1                # previous boot
journalctl -b                   # current boot
```

The `-b` flag is especially useful after a crash: `journalctl -b -1` shows you everything from the boot that failed.

## Making journald persistent

Here's something that catches people off guard: journald might not persist logs across reboots by default. On some systems, logs are stored in `/run/log/journal/` (volatile, gone after reboot) instead of `/var/log/journal/` (persistent).

To enable persistence:

```bash
sudo mkdir -p /var/log/journal
sudo systemctl restart systemd-journald
```

Control the size in `/etc/systemd/journald.conf`:

```ini
[System]
SystemMaxUse=500M
SystemMaxFileSize=50M
RuntimeMaxUse=200M
```

Then restart journald. Without this, your journal might fill up the disk or get cleaned aggressively.

## rsyslog: text file logging

Rsyslog writes the log files you probably already know:

- `/var/log/syslog` , main system log
- `/var/log/auth.log` , authentication (SSH logins, sudo, etc.)
- `/var/log/kern.log` , kernel messages
- `/var/log/daemon.log` , daemon messages

Configuration lives in `/etc/rsyslog.conf` and `/etc/rsyslog.d/`.

The strength of text logs is simplicity. `grep "error" /var/log/syslog` works. `grep -i "failed" /var/log/auth.log` works. You can pipe them, parse them, feed them to other tools.

## Sending logs to a remote server

For centralized logging, rsyslog can forward logs.

On the receiving server, enable reception in `/etc/rsyslog.conf`:

```ini
module(load="imudp")
input(type="imudp" port="514")

module(load="imtcp")
input(type="imtcp" port="514")
```

On the sending server, create `/etc/rsyslog.d/remote.conf`:

```
*.* @logserver.example.com:514       # UDP
*.* @@logserver.example.com:514      # TCP
```

One `@` is UDP (fast, fire-and-forget). Two `@@` is TCP (reliable, ordered). Use TCP if you can't afford to lose log entries.

## Searching both systems

For journalctl, use its built-in filtering:

```bash
journalctl -u nginx --grep="error"
```

For text logs, grep works as you'd expect:

```bash
grep "error" /var/log/syslog
```

For rotated (gzipped) logs:

```bash
zgrep "error" /var/log/syslog.2.gz
```

The problem might have happened yesterday. Rotated logs are your friend.

## Log rotation

Logrotate prevents logs from eating your disk. Configuration is in `/etc/logrotate.conf` and `/etc/logrotate.d/`.

A typical config for a custom application:

```
/var/log/myapp/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 appuser appuser
    postrotate
        systemctl reload myapp > /dev/null 2>&1 || true
    endscript
}
```

The `postrotate` block is important: it tells the service to reopen its log file after rotation. Without it, the service keeps writing to the old (now renamed) file.

Test your config before trusting it:

```bash
sudo logrotate -d /etc/logrotate.d/myapp    # dry run
sudo logrotate -f /etc/logrotate.d/myapp    # force rotation now
```

## Things I've learned the hard way

Check both journald and rsyslog when you can't find something. Services choose where to log, and they don't always choose what you'd expect.

Set up log rotation from the start. I once had a server go down at 2 AM because a log file grew to 40GB and filled the disk. The application kept writing, the disk filled, and everything that depended on that disk stopped working.

Don't forget about rotated logs. If the incident was yesterday, the log might be in `syslog.1` or `syslog.2.gz`. The answer is probably still there, just compressed.
