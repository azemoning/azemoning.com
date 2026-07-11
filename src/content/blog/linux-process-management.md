---
title: "Linux process management: ps, top, and beyond"
slug: "linux-process-management"
date: 2018-10-13
category: "Linux"
tags: ["linux", "processes", "monitoring", "troubleshooting"]
readingTime: "7 min read"
excerpt: "Finding runaway processes, understanding process states, and managing background jobs."
---

Something is eating 100% CPU on your production server. Users are complaining that the API is slow. You have maybe 5 minutes before the on-call escalation gets worse. You SSH in. Now what?

```bash
top
```

There it is. Some Python process you don't recognize, PID 14832, pegging a core. But before you kill it, you need to know what it is, who started it, and whether killing it will break something important.

This is process management. Knowing what's running, understanding what it's doing, and deciding whether to let it run or make it stop.

<!-- truncate -->

## ps: the snapshot

`ps` shows you what's running right now. The most useful invocation:

```bash
ps aux
```

- `a` , all users' processes
- `u` , user-oriented format (shows CPU%, memory%, who owns it)
- `x` , include processes without a terminal (daemons, services)

Columns that matter:

- `%CPU` , processor usage
- `%MEM` , memory usage
- `STAT` , process state
- `COMMAND` , what's running

Filter by name:

```bash
ps aux | grep python
```

Show the process tree (parent-child relationships):

```bash
ps auxf
# or
pstree -p
```

The tree view is useful when you need to understand which process spawned what. If a web server spawned 50 worker processes, the tree shows that clearly. If a cron job launched a script that launched another script, you can trace the chain.

Back to our mystery Python process:

```bash
ps aux | grep 14832
```

This shows the full command, the user who started it, and when it started. Usually that's enough to figure out what it is.

## top: real-time

`ps` gives you a snapshot. `top` gives you a live, updating view. It refreshes every few seconds and sorts by CPU usage by default.

Inside top, useful keys:

- `1` , show per-core CPU usage (helps distinguish "100% of one core" from "100% of all cores")
- `M` , sort by memory
- `P` , sort by CPU
- `k` , kill a process by PID (prompts you for the PID and signal)
- `q` , quit

htop is better for longer monitoring:

```bash
sudo apt install htop
htop
```

Color display, mouse support, easier navigation, and you can search for processes by name. It's worth installing on every server you manage.

## What the process states mean

The `STAT` column in `ps` output tells you what a process is doing:

- `R` , running or runnable (on the CPU or waiting for CPU time)
- `S` , sleeping (waiting for something: I/O, a signal, a timer)
- `D` , disk sleep (uninterruptible, stuck waiting for I/O)
- `Z` , zombie (process exited but its parent hasn't collected the exit status)
- `T` , stopped (paused by a signal or Ctrl+Z)

A few zombies are normal and harmless. The parent will clean them up eventually. Hundreds of zombies usually mean a parent process is buggy and not calling `wait()` on its children.

D state processes are stuck waiting for storage I/O. If you see many of them, your disk or network storage might be having problems. There's not much you can do from the OS side except wait for the I/O to complete or fix the underlying storage issue.

## Signals: talking to processes

Processes communicate via signals. The ones you'll use:

```bash
kill PID              # SIGTERM (15) , asks the process to shut down gracefully
kill -9 PID           # SIGKILL (9) , forces immediate death, no cleanup
kill -HUP PID         # SIGHUP (1) , traditionally "reload config"
kill -USR1 PID        # user-defined, often "reopen log file"
```

Always try `kill` (SIGTERM) first. Give the process a few seconds to clean up: close files, finish transactions, notify its children. Only escalate to `kill -9` if SIGTERM doesn't work. `kill -9` doesn't let the process do any cleanup, which can leave temp files, corrupt data, or orphan child processes.

Find and kill by name:

```bash
pkill python        # kill all processes named "python"
killall node        # kill all processes named "node"
```

Be careful with these. `pkill python` kills every Python process on the system, not just the one you're angry at. Use `pgrep` first to see what you'd be killing:

```bash
pgrep -a python     # show PIDs and full commands
```

## Background jobs

Run a command in the background:

```bash
./long-script.sh &
```

Suspend a running command: Ctrl+Z

List background jobs:

```bash
jobs
```

Bring one to the foreground:

```bash
fg %1
```

Send it back to background:

```bash
bg %1
```

For processes that need to survive your SSH session disconnecting, `nohup` or a terminal multiplexer (screen, tmux) are the traditional approach:

```bash
nohup ./long-script.sh &
```

But for anything that should run reliably, use systemd. It handles restart on failure, logging, and boot persistence. Background jobs with `nohup` are fine for one-off tasks, not for production services.

## Process priority

Priority ranges from -20 (highest) to 19 (lowest). Default is 0.

Start a process with lower priority:

```bash
nice -n 10 ./cpu-intensive-task.sh
```

Change priority of a running process:

```bash
renice 10 -p PID
```

Only root can raise priority (lower nice value). Regular users can only lower it. This prevents regular users from gaming the scheduler to get more CPU time.

## lsof: what files does a process have open?

Everything in Linux is a file, including network connections. `lsof` shows what a process has open:

```bash
lsof -p PID                 # all files opened by a process
lsof -i :80                 # what's using port 80
lsof -u username            # files opened by a user
```

This is invaluable when you're trying to figure out why you can't unmount a filesystem ("device is busy"):

```bash
lsof +D /mnt/usb
```

It shows every process that has a file open on that mount. Kill or wait for those processes, then unmount.

## The diagnostic flow

When something's wrong with a server, this is the sequence I follow:

1. `top` or `htop` to see what's using CPU and memory
2. `ps auxf` to see the process tree and relationships
3. `lsof -p PID` to see what files the suspect process has open
4. `kill PID` to ask it to stop (SIGTERM)
5. Wait 5 seconds
6. `kill -9 PID` if it didn't stop

That's usually enough. The key is reading the output: who owns the process, what command started it, how much resource it's using, and what state it's in. The tools are simple. The skill is knowing what the output means and what to do about it.
