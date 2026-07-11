---
title: "grep, sed, and awk: the Linux text processing trio"
slug: "grep-sed-awk-linux-text-processing"
date: 2018-03-07
category: "Linux"
tags: ["linux", "grep", "sed", "awk", "text-processing", "cli"]
readingTime: "10 min read"
excerpt: "Finding, replacing, and transforming text from the command line. Practical examples for each tool."
---

Your nginx access log has 2 million lines. Someone is hammering `/api/login` and you need to find out which IPs are doing it, how often, and whether it's gotten worse in the last hour. You could load it into a log analysis tool, but that takes time to set up. Or you could answer the question right now, from the terminal, with tools that are already installed.

That's what grep, sed, and awk are for. They're the three tools that handle most text processing on a Linux server. I'll build up the solution to that nginx problem as we go, introducing each tool where it fits.

<!-- truncate -->

## Step 1: Find the lines with grep

First, grab every line that mentions `/api/login`:

```bash
grep "/api/login" /var/log/nginx/access.log
```

That's it. grep searches for patterns in files. But 2 million lines matching is still too many to read. A few useful flags:

```bash
grep -c "/api/login" /var/log/nginx/access.log   # count matches
grep -i "/api/login" /var/log/nginx/access.log    # case insensitive
grep -n "/api/login" /var/log/nginx/access.log    # show line numbers
grep -v "GET" /var/log/nginx/access.log            # invert: show non-matching lines
```

`-c` gives you the count. That alone tells you how big the problem is.

For pattern matching, grep supports regular expressions:

```bash
grep "^10\.0\." /var/log/nginx/access.log     # lines starting with 10.0.
grep " 500 " /var/log/nginx/access.log          # 500 status codes
grep -E "error|warning|critical" /var/log/syslog  # alternation with -E
```

`-E` (or `egrep`) enables extended regex, which gives you `+`, `?`, `|`, and groups without escaping.

grep is fast. For searching large files, it's almost always the right first step. But it finds lines. It doesn't extract fields or count things. For that, we need more tools.

## Step 2: Extract the IPs with awk

Each nginx access log line looks something like this:

```
192.168.1.50 - - [10/Mar/2024:14:32:01 +0000] "POST /api/login HTTP/1.1" 200 532
```

The IP is the first field. awk is built for extracting fields:

```bash
grep "/api/login" /var/log/nginx/access.log | awk '{print $1}'
```

Now we have just the IPs. But we still have duplicates and no counts.

## Counting and sorting

Pipe through `sort`, `uniq -c`, and `sort -rn`:

```bash
grep "/api/login" /var/log/nginx/access.log | \
  awk '{print $1}' | \
  sort | \
  uniq -c | \
  sort -rn | \
  head -10
```

This gives you the top 10 IPs hitting `/api/login`, sorted by request count. The full pipeline: find the lines, extract the IP field, sort them (uniq needs sorted input), count duplicates, sort by count descending, show the top 10.

That's the answer. Five commands piped together, no scripts, no log analysis tools, done in seconds even on a 2 million line file.

## More grep: what it's actually for

grep's job is simple: show me lines matching this pattern. Here are the patterns I use most:

```bash
grep -r "password" /etc/                    # recursive search through a directory
grep -l "error" /var/log/*.log              # show only filenames with matches
grep -A 3 "error" /var/log/syslog           # show 3 lines after each match
grep -B 2 "error" /var/log/syslog           # show 2 lines before each match
grep -C 2 "error" /var/log/syslog           # 2 lines before and after
```

The context flags (`-A`, `-B`, `-C`) are useful when you need to see what happened around an error, not just the error itself.

Always quote your patterns. `grep pattern` can be expanded by shell globbing before grep sees it. `grep "pattern"` is safe.

## sed: finding and replacing

sed processes text line by line. Its most common use is substitution:

```bash
sed 's/old/new/' file.txt              # replace first occurrence per line
sed 's/old/new/g' file.txt             # replace all occurrences per line
sed -i 's/old/new/g' file.txt          # edit the file in place
```

The `g` flag matters. Without it, sed only replaces the first match on each line. Almost always use `/g`.

Delete lines matching a pattern:

```bash
sed '/pattern/d' file.txt
sed '3d' file.txt           # delete line 3
sed '1,5d' file.txt         # delete lines 1 through 5
```

Print specific lines (useful with `-n` to suppress the rest):

```bash
sed -n '10p' file.txt       # print only line 10
sed -n '10,20p' file.txt    # print lines 10-20
```

Multiple operations in sequence:

```bash
sed -e 's/foo/bar/g' -e 's/baz/qux/g' file.txt
```

Capture groups let you rearrange text:

```bash
echo "hello world" | sed -E 's/(.*) (.*)/\2 \1/'
# output: world hello
```

sed is the right tool when the task is "replace this with that" or "remove these lines." For extracting fields or doing calculations, awk is better.

## awk: structured data processing

awk is a full programming language for text processing. It's overkill for simple searches but invaluable for anything involving columns, arithmetic, or formatted output.

The basic shape:

```bash
awk 'pattern { action }' file.txt
```

Print specific columns (whitespace is the default delimiter):

```bash
awk '{print $1}' file.txt               # first column
awk '{print $1, $3}' file.txt           # first and third columns
awk -F: '{print $1}' /etc/passwd        # custom delimiter
```

Filter rows by condition:

```bash
awk '$3 > 100 {print $1, $3}' file.txt  # rows where column 3 exceeds 100
awk '/error/ {print}' /var/log/syslog   # lines matching a pattern
```

Useful built-in variables:

```bash
awk '{print NR, $0}' file.txt           # NR = line number
awk 'END {print NR}' file.txt           # total line count
awk -F: '{print NF, $0}' /etc/passwd    # NF = number of fields per line
```

Calculations:

```bash
awk '{sum += $3} END {print sum}' file.txt
awk '{sum += $3} END {print sum/NR}' file.txt  # average
```

Formatted output:

```bash
awk -F: '{printf "%-20s %s\n", $1, $7}' /etc/passwd
```

awk reads a file line by line, splits each line into fields, and applies your rules. It's fast and it handles the "I need to pull out column 3, filter by column 5, and sum column 7" cases that would be awkward in bash.

## Back to the nginx problem

Let's extend our earlier pipeline. Suppose you want the top IPs, but only for 500 errors, and only from the last 50,000 lines (roughly the last hour of traffic):

```bash
tail -50000 /var/log/nginx/access.log | \
  grep "/api/login" | \
  grep " 500 " | \
  awk '{print $1}' | \
  sort | uniq -c | sort -rn | head -10
```

Or, use awk for the whole thing:

```bash
tail -50000 /var/log/nginx/access.log | \
  awk '/\/api\/login/ && / 500 / {print $1}' | \
  sort | uniq -c | sort -rn | head -10
```

Both produce the same result. The awk version is more compact. The grep version is more readable if you're not comfortable with awk patterns. Either way, you get your answer in under a second.

## When to use which

grep: "Show me lines matching this." Finding things.

sed: "Replace this with that." Editing text in place or transforming it.

awk: "Extract columns, filter by conditions, calculate." Structured data processing.

For simple searches, grep. For substitutions, sed. For anything involving columns, numbers, or formatted output, awk. These three cover the vast majority of text processing you'll do on a server. When you need something more complex, there's Python, but I reach for these first because they're faster to type and faster to run.
