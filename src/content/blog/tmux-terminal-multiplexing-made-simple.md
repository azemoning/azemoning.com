---
title: "tmux: terminal multiplexing made simple"
slug: "tmux-terminal-multiplexing-made-simple"
date: 2021-08-02
category: "Linux"
tags: ["linux", "tmux", "terminal", "productivity"]
readingTime: "6 min read"
excerpt: "Using tmux to manage terminal sessions. Panes, windows, and why your SSH sessions should survive disconnects."
---

Three hours into a database migration. SSH session to a remote server in Jakarta. The migration was halfway done, processing a few million rows. My laptop went to sleep for a coffee break. When I came back, the WiFi had reconnected but the SSH session was dead. The migration was still running on the server (I checked), but I had no way to see the output or know when it finished.

<!-- truncate -->

That was the last time I ran anything important outside of tmux.

tmux keeps your terminal sessions alive when you disconnect. Not just the processes, the entire session: your shell, your output, your scrollback. You detach, walk away, come back, attach, and everything is exactly where you left it.

## The basics

Start tmux:

```bash
tmux
```

You're now inside a tmux session. It looks like a normal terminal. The difference is that this session is independent of your SSH connection.

Detach (leave tmux running, go back to your regular terminal):

```
Ctrl+b d
```

That's the prefix key (`Ctrl+b`) followed by `d` (detach). Every tmux shortcut starts with the prefix.

Reattach:

```bash
tmux attach
# or shorter:
tmux a
```

If you have multiple sessions:

```bash
tmux ls           # list sessions
tmux attach -t 0  # attach to session 0
```

Named sessions are easier to keep track of:

```bash
tmux new -s deploy
tmux attach -t deploy
```

## Windows

Windows are like browser tabs. Each one is a separate terminal.

| Action | Shortcut |
|--------|----------|
| New window | `Ctrl+b c` |
| Next window | `Ctrl+b n` |
| Previous window | `Ctrl+b p` |
| Switch by number | `Ctrl+b 0` (or 1, 2, ...) |
| List windows | `Ctrl+b w` |
| Rename window | `Ctrl+b ,` |
| Close window | `Ctrl+b &` |

I name my windows after what they're doing: "logs", "deploy", "db". Makes switching fast with `Ctrl+b w`.

## Panes

Split the current window into panes. Two or more terminals in one screen.

| Action | Shortcut |
|--------|----------|
| Split horizontally | `Ctrl+b %` |
| Split vertically | `Ctrl+b "` |
| Switch to next pane | `Ctrl+b o` |
| Switch by direction | `Ctrl+b ←↑↓→` |
| Close pane | `Ctrl+b x` |
| Zoom pane (toggle fullscreen) | `Ctrl+b z` |
| Resize pane | `Ctrl+b Ctrl+←↑↓→` |

My typical setup: left pane running `tail -f` on logs, right pane for typing commands. When I need more space for the logs, `Ctrl+b z` to zoom the left pane fullscreen, same shortcut to go back.

## Copy mode

When you need to scroll back through output:

```
Ctrl+b [
```

Navigate with arrow keys (or `j`/`k` if you've enabled vi keys). Start selection with `Space`, copy with `Enter`, paste with `Ctrl+b ]`. Exit copy mode with `q`.

This is tmux's weakest feature honestly. For serious scrolling and searching, I usually pipe output to `less` instead.

## Configuration

Create `~/.tmux.conf`:

```
# Mouse support (scroll, click to switch panes)
set -g mouse on

# Start counting from 1 (0 is far from the prefix key)
set -g base-index 1
setw -g pane-base-index 1

# More scrollback history
set -g history-limit 50000

# Vi keys in copy mode
setw -g mode-keys vi

# Reload config without restarting tmux
bind r source-file ~/.tmux.conf \; display "Config reloaded"
```

After editing, either restart tmux or use `Ctrl+b r` if you added the reload binding.

## Practical patterns

**The long-running task:**

```bash
tmux new -s migration
# start your migration script
# Ctrl+b d to detach
# come back later:
tmux attach -t migration
```

Your process never stopped. Your output is still there. This is the entire reason I use tmux.

**Side-by-side monitoring:**

```bash
tmux
# Ctrl+b % to split vertically
# in the left pane:
tail -f /var/log/nginx/access.log
# Ctrl+b o to switch to right pane:
tail -f /var/log/nginx/error.log
```

**Multiple projects, one SSH session:**

```bash
tmux new -s frontend
tmux new -s backend
tmux new -s ops
tmux switch -t backend
```

Each "session" is a separate workspace. Switch between them without opening new SSH connections.

**Pair programming:**

Two people can attach to the same tmux session. Both see the same terminal. Both can type. It's the CLI equivalent of screen sharing.

```bash
# Person 1:
tmux new -s pair

# Person 2 (on the same server):
tmux attach -t pair
```

## tmux vs screen

GNU screen does the same thing, roughly. tmux has better pane support, cleaner config, and more active development. Screen is older and simpler. If you're choosing today, tmux. If you already know screen and it works for you, no reason to switch.

One gotcha with either tool: if you SSH from inside a tmux session to another server that also runs tmux, the keybindings conflict. The inner tmux captures `Ctrl+b` before the outer one sees it. Fix this by changing the prefix key on one of them:

```
# In the outer tmux:
set -g prefix C-a
```

## Quick reference

```
tmux                         # new session
tmux new -s name             # named session
tmux ls                      # list sessions
tmux attach -t name          # attach
tmux kill-session -t name    # kill session
tmux kill-server             # kill everything
```

Inside tmux: `Ctrl+b d` to detach, `Ctrl+b c` for new window, `Ctrl+b %` to split, `Ctrl+b z` to zoom pane.

The basics take about 10 minutes to learn. You'll use them every day. The advanced stuff (scripting layouts, custom status bars, nested sessions) you can pick up as needed. Start with `tmux`, split a pane, detach and reattach. That alone will change how you work over SSH.
