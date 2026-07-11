---
title: "SSH hardening: securing remote access"
slug: "ssh-hardening-securing-remote-access"
date: 2021-04-24
category: "Linux"
tags: ["linux", "ssh", "security", "networking"]
readingTime: "9 min read"
excerpt: "Practical steps to lock down SSH on your Linux server. Key-based auth, disabling root login, and fail2ban basics."
---

I was checking auth.log on a fresh VPS I'd set up the night before. The server had been online for maybe 14 hours.

```bash
grep "Failed password" /var/log/auth.log | wc -l
```

`8,473`

Fourteen hours. Eight thousand failed password attempts. Every one of them an automated bot trying common usernames (root, admin, ubuntu, test) with random passwords. The server was fine, nothing got in, but the noise was a preview of what happens to every SSH server exposed to the internet.

Default SSH configuration works. But "works" and "secure" are different things. A handful of changes takes you from "shrugs off attacks" to "makes attackers move on to easier targets."

<!-- truncate -->

## Key-based authentication (do this first)

Keys can't be brute-forced the way passwords can. Generate a key pair:

```bash
ssh-keygen -t ed25519 -C "upi@workstation"
```

ed25519 is the current recommendation. RSA 4096 is fine too but ed25519 keys are shorter and just as strong.

Copy the public key to your server:

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub upi@server
```

Test that you can log in with the key before changing any SSH settings:

```bash
ssh -i ~/.ssh/id_ed25519 upi@server
```

If that works, you're ready to disable passwords.

## Disable password authentication

Edit `/etc/ssh/sshd_config`:

```
PasswordAuthentication no
PubkeyAuthentication yes
```

Restart SSH:

```bash
sudo systemctl restart sshd
```

Critical: keep your current SSH session open while you test a new connection in a separate terminal. If key auth isn't working and you've already disabled passwords, you've locked yourself out. This happens more often than you'd think. The fix usually involves console access from your hosting provider.

## Disable root login

Root is the account every attacker tries first. Remove it from SSH entirely:

```
PermitRootLogin no
```

Use a regular user with sudo instead. This gives you an audit trail (you can see who ran what with sudo) and eliminates the highest-value target.

If root is your only account with sudo access, create a regular user first and add them to the sudo group. Otherwise disabling root login locks you out of administrative access.

## Change the default port

This is security through obscurity, and I won't pretend otherwise. But it cuts the automated brute-force noise to nearly zero because most bots only scan port 22.

```
Port 2222
```

Pick any high port. Then configure your SSH client to remember it:

```
# ~/.ssh/config
Host myserver
    HostName server.example.com
    Port 2222
    User upi
```

Now `ssh myserver` connects on port 2222 without you typing it every time.

## Restrict who can log in

Only allow specific users:

```
AllowUsers upi admin
```

Or allow by group:

```
AllowGroups sshusers
```

This prevents service accounts and other system users from being SSH targets. If nobody should be able to SSH in as `postgres`, make sure `postgres` isn't in the allowed list.

## Kill idle sessions

An unattended SSH session is a risk. Someone walks away from their laptop, the session stays open, and anyone with physical access has a shell on your server.

```
ClientAliveInterval 300
ClientAliveCountMax 2
```

This disconnects idle sessions after 10 minutes (300 seconds times 2 checks). The client gets a keepalive message and if it doesn't respond twice, the connection drops.

## Rate limiting with fail2ban

Even with key-only auth and a non-standard port, fail2ban is worth running. It watches auth.log and bans IPs that show suspicious behavior.

Install it:

```bash
sudo apt install fail2ban
```

Create a local config (don't edit the default, it gets overwritten on updates):

```bash
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
```

Edit `/etc/fail2ban/jail.local`:

```ini
[sshd]
enabled = true
port = 2222
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
findtime = 600
```

Three failed attempts within 10 minutes gets an IP banned for an hour. Adjust to taste. I've seen people set `bantime` to 24 hours or more.

Start and enable it:

```bash
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

Check what it's caught:

```bash
sudo fail2ban-client status sshd
```

## Jumping through bastion hosts

If you have a bastion host (jump box) that gates access to internal servers, avoid agent forwarding. `ssh -A` passes your agent to the bastion, but anyone with root on the bastion can use your forwarded agent to access other servers.

Use ProxyJump instead:

```bash
ssh -J bastion destination
```

This creates a direct tunnel through the bastion without exposing your agent. In your SSH config:

```
Host bastion
    HostName bastion.example.com
    User upi
    Port 2222

Host internal-server
    HostName 10.0.1.50
    User upi
    ProxyJump bastion
```

## Two-factor authentication

For an extra layer, set up TOTP (time-based one-time passwords) with Google Authenticator:

```bash
sudo apt install libpam-google-authenticator
google-authenticator
```

Follow the prompts to generate a QR code, scan it with your phone's authenticator app, then configure PAM and sshd to require it. Now an attacker needs both your SSH key and your phone to get in.

This combines something you have (the TOTP token) with something you have (your SSH key) or know (your key passphrase). Two factors, two things to compromise.

## Checking your work

After making changes, verify everything from your current session before closing it:

```bash
# Check config syntax
sudo sshd -t

# Restart
sudo systemctl restart sshd

# Test in a NEW terminal (keep the old one open)
ssh upi@server
```

Monitor the auth log to see the changes take effect:

```bash
sudo tail -f /var/log/auth.log
```

After a few days with key-only auth, a non-standard port, and fail2ban, check your auth.log again. The failed password attempts should be a fraction of what they were. Most bots move on when port 22 doesn't answer.

SSH hardening is one of the first things to do on any new server. These changes take 15 minutes and they handle the majority of threats. Every server I set up gets this treatment before anything else goes on it.
