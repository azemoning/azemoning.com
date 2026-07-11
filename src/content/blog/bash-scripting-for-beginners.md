---
title: "Bash scripting for beginners"
slug: "bash-scripting-for-beginners"
date: 2019-07-18
category: "Linux"
tags: ["linux", "bash", "scripting", "automation"]
readingTime: "10 min read"
excerpt: "Writing your first bash scripts. Variables, conditionals, loops, and the patterns you'll actually use on a server."
---

It was 3 AM and my phone buzzed. Disk usage on the production database server had hit 95%. I SSH'd in, half-asleep, and started manually clearing old logs. After the third `rm` command I thought: why am I doing this by hand?

I wrote a 15-line bash script right there. It found logs older than 7 days, compressed them, and deleted anything older than 30. Ran it once, disk dropped to 62%. Put it in cron, went back to bed. That script ran every night for two years without me touching it again.

That's bash scripting. Not glamorous, not clever, just solving a problem with the tools that are already on the machine.

<!-- truncate -->

## Getting started

Every bash script starts with a shebang. This tells the system which interpreter to use:

```bash
#!/bin/bash
```

Save it, make it executable, run it:

```bash
chmod +x cleanup.sh
./cleanup.sh
```

Or run it explicitly with `bash cleanup.sh`. Either way works. I prefer making scripts executable because then they behave like any other command.

## Variables

No spaces around the equals sign. This trips up everyone once:

```bash
name="production"
count=42
filepath="/var/log/syslog"
```

Use variables with `$`:

```bash
echo "Deploying to $name"
echo "Count: ${count}total"
```

The curly braces are needed when the variable name runs into surrounding text. Without them, bash would try to interpret `$counttotal` as one variable name.

Command substitution captures the output of a command:

```bash
current_date=$(date +%Y-%m-%d)
hostname=$(hostname)
file_count=$(ls -1 | wc -l)
```

Always use `$()` instead of backticks. They nest better and are easier to read. Backticks are the old way. You'll see them in old scripts but don't write new ones with them.

## Conditionals

```bash
if [ "$1" = "start" ]; then
    echo "Starting..."
elif [ "$1" = "stop" ]; then
    echo "Stopping..."
else
    echo "Usage: $0 {start|stop}"
    exit 1
fi
```

Spaces around the brackets are mandatory. `[ "$1" = "start" ]` works. `["$1"="start"]` doesn't. This is probably the most common syntax error beginners hit, and the error message is not helpful.

File tests are handy:

```bash
if [ -f "/etc/nginx/nginx.conf" ]; then
    echo "Config exists"
fi

if [ -d "/opt/app" ]; then
    echo "Directory exists"
fi
```

Numeric comparisons use different operators than strings:

```bash
if [ "$count" -gt 10 ]; then
    echo "More than 10"
fi
```

`-eq`, `-ne`, `-gt`, `-lt`, `-ge`, `-le` for numbers. `=` and `!=` for strings. Mixing them up is a subtle bug because `[ "5" > "10" ]` does a string comparison and says 5 is greater than 10.

## Loops

For loops iterate over lists:

```bash
for file in /var/log/*.log; do
    echo "Processing $file"
    wc -l "$file"
done
```

```bash
for i in {1..10}; do
    echo "Iteration $i"
done
```

While loops are good for reading input line by line:

```bash
while read -r line; do
    echo "Line: $line"
done < /etc/hosts
```

The `-r` flag prevents backslash interpretation. Without it, backslashes in the input get eaten. Always use `-r`.

## Functions

```bash
log_message() {
    local level="$1"
    local message="$2"
    echo "$(date '+%Y-%m-%d %H:%M:%S') [$level] $message"
}

log_message "INFO" "Script started"
log_message "ERROR" "Something went wrong"
```

`local` keeps variables scoped to the function. Without it, they're global. This matters more than you'd think, especially in longer scripts where you might accidentally shadow a variable name.

## Arguments and exit codes

Script arguments are `$1`, `$2`, `$3`, etc. `$0` is the script name. `$#` is the argument count. `$@` is all arguments.

```bash
if [ $# -lt 2 ]; then
    echo "Usage: $0 <source> <destination>"
    exit 1
fi

source="$1"
destination="$2"
```

Exit codes are how the rest of the system knows if your script worked. 0 means success, anything else means failure. Set them explicitly:

```bash
if ! command -v nginx > /dev/null 2>&1; then
    echo "nginx is not installed"
    exit 1
fi
```

## Error handling

This line should be near the top of every script:

```bash
set -euo pipefail
```

`-e` exits if any command fails. `-u` treats unset variables as errors. `-o pipefail` catches failures in the middle of a pipe. Without these, your script will happily continue after a command fails, potentially doing more damage with bad data.

For cleanup, use a trap:

```bash
cleanup() {
    rm -f "$temp_file"
}
trap cleanup EXIT

temp_file=$(mktemp)
```

The `EXIT` trap fires when the script exits, whether it succeeded or failed. This is how you avoid leaving temp files around.

## A real example

Here's a script that checks if a web server is running and restarts it if it's not:

```bash
#!/bin/bash
set -euo pipefail

SERVICE="nginx"
LOG="/var/log/service-watchdog.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG"
}

if ! systemctl is-active --quiet "$SERVICE"; then
    log "$SERVICE is not running, restarting..."
    systemctl restart "$SERVICE"
    log "$SERVICE restarted"
else
    log "$SERVICE is running (PID: $(systemctl show -p MainPID --value $SERVICE))"
fi
```

Short, readable, does one thing. That's the sweet spot for bash.

## When to stop using bash

Bash is glue code. It connects tools, runs commands in sequence, checks exit codes, and sends notifications. For anything involving complex data structures, JSON parsing, HTTP requests, or real logic, use Python or another language.

The line I draw: if the script is longer than about 80 lines, or if I'm fighting the language to express what I want, it's time to switch. Bash doesn't have real error handling, its arrays are painful, and debugging is mostly `echo` statements.

But for "check this thing, do that thing, tell me if it worked," nothing beats writing a bash script. It's always there, it can call every other tool on the system, and a 20-line script that saves you 10 minutes a day is worth 200 hours a year.
