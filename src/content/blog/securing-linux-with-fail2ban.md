---
title: "Securing Linux with fail2ban"
slug: "securing-linux-with-fail2ban"
date: 2021-01-21
category: "Linux"
tags: ["linux", "fail2ban", "security", "intrusion-prevention"]
readingTime: "7 min read"
excerpt: "Setting up fail2ban to protect SSH and web services. Writing custom filters and understanding ban actions."
---

Run this on any server with SSH exposed to the internet:

```bash
sudo lastb | wc -l
```

That shows you the number of failed login attempts. On a server I set up last month, that number was 12,847. In three days. From IP addresses in countries I've never been to, trying usernames like `admin`, `ubuntu`, `root`, `test`, `oracle`, and my personal favorite, `git`.

These aren't targeted attacks. They're automated bots scanning the internet for servers with weak passwords. They try thousands of combinations per day, and they never stop.

Fail2ban watches your log files for these patterns and bans the offending IPs by updating your firewall rules. It's one of the simplest security improvements you can make.

<!-- truncate -->

## Installation

```bash
sudo apt install fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

That's it for the install. The configuration is where the interesting stuff happens.

## Configuration structure

Don't edit `/etc/fail2ban/jail.conf` directly. Package updates will overwrite it. Instead, create a local override:

```bash
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
```

Or better, create files in `/etc/fail2ban/jail.d/`:

```bash
sudo nano /etc/fail2ban/jail.d/custom.conf
```

The `.d/` directory approach keeps your customizations clean and separate.

## Protecting SSH

This is the first thing to configure:

```ini
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
findtime = 600
```

What those mean:
- `maxretry = 3` , three failed attempts triggers a ban
- `findtime = 600` , the window for counting failures is 10 minutes
- `bantime = 3600` , ban lasts 1 hour (3600 seconds)

So: three wrong passwords in 10 minutes, and that IP is blocked for an hour.

For incremental punishment (each offense gets a longer ban):

```ini
bantime = 10m
bantime.increment = true
bantime.factor = 2
bantime.maxtime = 4w
```

First offense: 10 minutes. Second: 20 minutes. Third: 40 minutes. Caps at 4 weeks. I like this approach because it's harsh on repeat offenders but forgiving of honest mistakes.

## Protecting other services

Fail2ban ships with filters for many common services:

```ini
[nginx-http-auth]
enabled = true
port = http,https
filter = nginx-http-auth
logpath = /var/log/nginx/error.log
maxretry = 3
bantime = 3600

[postfix]
enabled = true
port = smtp,ssmtp
filter = postfix
logpath = /var/log/mail.log
maxretry = 5
bantime = 3600
```

For web login forms, give users more chances. People mistype passwords. `maxretry = 5` or even `10` is more reasonable than `3` for a login page.

## Custom filters

If your application isn't covered by the built-in filters, write your own. Filters live in `/etc/fail2ban/filter.d/`.

Create a custom filter:

```bash
sudo nano /etc/fail2ban/filter.d/myapp.conf
```

```ini
[Definition]
failregex = ^.*Failed login from <HOST>.*$
            ^.*Authentication error from <HOST>.*$
ignoreregex =
```

The `<HOST>` placeholder matches an IP address. Test your filter against a real log file:

```bash
sudo fail2ban-regex /var/log/myapp.log /etc/fail2ban/filter.d/myapp.conf
```

This shows you which lines match and which don't. Essential for debugging regex patterns (which, let's be honest, always need debugging).

## Ban actions

The default action adds the banned IP to iptables. You can also send email notifications:

```ini
action = %(action_mwl)s
```

This sends an email with the relevant log lines when a ban happens. Useful if you want to know what's being blocked without checking the fail2ban logs.

## Managing bans

Check overall status:

```bash
sudo fail2ban-client status
```

Check a specific jail:

```bash
sudo fail2ban-client status sshd
```

Manually ban an IP:

```bash
sudo fail2ban-client set sshd banip 192.168.1.100
```

Unban:

```bash
sudo fail2ban-client set sshd unbanip 192.168.1.100
```

List banned IPs:

```bash
sudo fail2ban-client set sshd banip list
```

## The recidive jail

This is clever: ban repeat offenders across all jails.

```ini
[recidive]
enabled = true
filter = recidive
logpath = /var/log/fail2ban.log
bantime = 604800  # 1 week
findtime = 86400  # 1 day
maxretry = 3
```

If an IP gets banned three times in a day (from any jail), it gets banned for a week. This catches the bots that try different services after getting blocked from SSH.

## The ignoreip setting

Add your own IP to the ignore list so you don't lock yourself out:

```ini
[DEFAULT]
ignoreip = 127.0.0.1/8 your.trusted.ip
```

I've locked myself out before. It's embarrassing, especially when you don't have console access and have to call someone to unban you. Set this up first.

## Common issues

**Editing jail.conf instead of jail.local.** Your changes get overwritten on package updates. Use `.local` or `.d/` files.

**Wrong log paths.** The `logpath` has to match where your service actually logs. Different distributions put logs in different places. Check before configuring.

**Aggressive settings on web forms.** Three retries for SSH is fine. Three retries for a web login form means frustrated users. Adjust `maxretry` based on the service.

**Not checking fail2ban after setup.** It's set-and-forget in terms of operation, but verify it's working: `sudo fail2ban-client status sshd` should show active bans if the server has been online for a while.

## What fail2ban isn't

It's not a firewall replacement. It's a complement. Fail2ban reacts to patterns in your logs; a firewall blocks by rule. You need both.

It's not going to stop a determined attacker with a botnet. But it will stop the vast majority of automated brute-force attempts, which is what you're dealing with 99% of the time.

The bots scanning the internet are looking for easy targets. Make your server slightly harder to attack, and they move on to the next one. That's all fail2ban needs to do.
