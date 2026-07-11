---
title: "Cron jobs: scheduling tasks on Linux"
slug: "cron-jobs-scheduling-tasks-on-linux"
date: 2018-02-24
category: "Linux"
tags: ["linux", "cron", "scheduling", "automation"]
readingTime: "7 min read"
excerpt: "How cron works, writing crontab entries, common pitfalls, and when to use alternatives."
---

You tested the script. It runs perfectly from the terminal. You add it to cron. The next morning, nothing happened. No error, no output, no indication that cron even tried. Welcome to the most common frustration in Linux automation.

The problem is almost always that cron's environment is nothing like your terminal's environment. Cron doesn't load your `.bashrc`, your `PATH` is minimal, and it doesn't know about your carefully configured aliases. Understanding this one fact saves you hours of debugging.

<!-- truncate -->

## How cron works

Each user has a crontab (cron table). Edit yours:

```bash
crontab -e
```

Each line has six fields:

```
*    *    *    *    *    command to execute
|    |    |    |    |
|    |    |    |    +----- day of week (0-6, Sunday=0)
|    |    |    +---------- month (1-12)
|    |    +--------------- day of month (1-31)
|    +-------------------- hour (0-23)
+------------------------- minute (0-59)
```

A few examples:

```
0 2 * * * /opt/scripts/backup.sh          # every day at 2:00 AM
*/5 * * * * /opt/scripts/check.sh          # every 5 minutes
0 9 * * 1 /opt/scripts/weekly-report.sh    # every Monday at 9 AM
0 0 1 * * /opt/scripts/monthly-cleanup.sh  # first of every month at midnight
```

There are also shortcut strings you can use instead of the five time fields:

- `@reboot` — run once at startup
- `@daily` or `@midnight` — once a day
- `@hourly` — once an hour
- `@weekly` — once a week
- `@monthly` — once a month

```
@reboot /opt/scripts/start-services.sh
@daily /opt/scripts/log-rotate.sh
```

## Why your cron job isn't running

The number one reason: environment differences. Cron runs with a `PATH` that's usually just `/usr/bin:/bin`. If your script calls commands in `/usr/local/bin` or `/usr/sbin`, cron can't find them.

Two fixes. Set PATH at the top of your crontab:

```
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

0 2 * * * /opt/scripts/backup.sh
```

Or use absolute paths everywhere. I prefer this because it's explicit about what runs:

```
0 2 * * * /usr/local/bin/python3 /opt/scripts/cleanup.py
```

The second most common reason: the last line in a crontab must end with a newline. If it doesn't, cron silently ignores it. This has bitten me more than once. Your editor might not add a trailing newline. Check.

## The percent sign trap

In cron syntax, `%` is treated as a newline. This means if your command uses `%` in a date format or anywhere else, you need to escape it:

```bash
# This breaks — cron interprets the % as line breaks
0 2 * * * date +%Y-%m-%d > /tmp/date.txt

# This works
0 2 * * * date +\%Y-\%m-\%d > /tmp/date.txt
```

The error you get is confusing because the command looks correct. You'll only figure it out by reading cron documentation or, more likely, by finding a Stack Overflow answer after an hour of head-scratching.

## Output and logging

By default, cron sends any output (stdout and stderr) via email to the crontab owner. On most servers, local mail isn't configured, so that output goes nowhere. Your job fails silently.

Redirect explicitly:

```
0 2 * * * /opt/scripts/backup.sh >> /var/log/backup.log 2>&1
```

Some people redirect everything to `/dev/null` to suppress output. I get why (cron's email noise is annoying) but it means you'll never know when a job fails. Better to log to a file and set up log rotation:

```
/var/log/backup.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
}
```

Drop that in `/etc/logrotate.d/backup` and your logs stay manageable.

## Race conditions

If a cron job takes longer than the interval between runs, you get overlapping executions. Your 5-minute health check might be running five copies simultaneously because the first one got stuck.

Use a lockfile:

```bash
#!/bin/bash
exec 200>/var/lock/myjob.lock
flock -n 200 || exit 1

# rest of script — only one instance runs at a time
```

`flock -n` tries to acquire the lock and exits immediately if another instance holds it. This is simple and reliable. For longer-running jobs, consider putting this in the script itself rather than relying on timing.

## Running as the wrong user

`crontab -e` edits your own crontab. To edit another user's crontab:

```bash
crontab -u username -e
```

System services should run from the service account's crontab, not root's. Running backup scripts as root when they only need read access to the data is an unnecessary risk. Use `crontab -u backupuser -e` to schedule them under the right account.

## System-wide cron

In addition to user crontabs, there are system directories:

```bash
/etc/cron.d/           # drop-in cron files
/etc/cron.daily/       # scripts run once daily
/etc/cron.hourly/      # scripts run once hourly
/etc/cron.weekly/      # scripts run once weekly
/etc/cron.monthly/     # scripts run once monthly
```

Scripts in these directories don't need a crontab entry. They're managed by the system's cron daemon (on Ubuntu, usually `anacron`, which handles machines that aren't always on).

## Testing cron entries

Before trusting a cron job, run the exact command from the crontab manually in a terminal. Not a similar command, the exact one. Then check syslog:

```bash
grep CRON /var/log/syslog
```

This shows when cron started your job. If the job doesn't appear in syslog at all, the crontab entry itself might be malformed. If it appears but fails, you'll see the error.

One more trick: temporarily change the schedule to run in the next minute so you can watch it happen:

```
* * * * * /opt/scripts/backup.sh >> /tmp/cron-test.log 2>&1
```

Watch `/tmp/cron-test.log`, verify it works, then change the schedule back. Remove the test crontab entry when you're done or you'll have a job running every minute forever.

## When cron isn't enough

Cron is fine for simple schedules. For more complex needs:

- **systemd timers** give you better logging (via journalctl), dependency management, and calendar event syntax
- **at** runs a command once at a future time (`echo "/opt/scripts/migrate.sh" | at 2am`)
- **anacron** handles machines that aren't always running (like laptops)

Cron has been around since the 1970s and it still works. The syntax is cryptic at first but becomes natural. The main things to remember: use absolute paths, handle output, escape percent signs, and end the file with a newline. When a cron job doesn't run, check syslog first. Nine times out of ten, it's the environment.
