---
title: "iptables essentials: a practical guide to Linux firewalling"
slug: "iptables-essentials"
date: 2018-06-28
category: "Linux"
tags: ["linux", "iptables", "firewall", "networking", "security"]
readingTime: "12 min read"
excerpt: "A hands-on guide to iptables. Covers chains, tables, rule syntax, and real examples for securing a Linux server."
---

I keep a mental list of tools that do exactly one thing well. rsync copies files. awk processes text. sed edits streams. iptables filters packets. These tools have been around for decades. They haven't been "disrupted." They work.

<!-- truncate -->

iptables is the standard Linux firewall. It looks at every packet entering or leaving your machine and applies rules you define: let it through, drop it, log it, redirect it. The rules are organized into tables and chains, which sounds more complicated than it is.

Even if you end up using nftables or firewalld (both are newer, both sit on top of the same kernel subsystem), understanding iptables means you understand what those tools are actually doing. When something breaks, you'll be debugging at the iptables level anyway.

## Before you start

You need root or sudo access. You need a terminal. And if you're working on a remote server, you need a backup way to reach it.

> [!WARNING]
> A bad firewall rule can lock you out of your own server. If you're connected via SSH, keep a second session open while you're changing rules. Or use a console connection. Getting locked out is a rite of passage, but it's a stupid one that's easy to avoid.

## The mental model

iptables organizes rules into **tables** and **chains**. Think of it like this:

A **table** is a category of operation. The `filter` table handles "allow or block." The `nat` table handles address translation (port forwarding, masquerading). There are others, but these two cover 95% of what you'll do.

A **chain** is a list of rules for a specific type of traffic. The `filter` table has three chains:

- **INPUT**: Packets coming to your machine
- **FORWARD**: Packets passing through your machine (routing)
- **OUTPUT**: Packets leaving your machine

For a typical server, you're writing rules in the INPUT chain. You're deciding which services the outside world can reach.

Each packet enters a chain and goes through the rules in order. First match wins. If no rule matches, the chain's default policy applies.

## Checking what's there

Before changing anything, see what you have:

```bash
sudo iptables -L -n -v
```

`-n` shows numbers instead of resolving hostnames (faster, and you see actual port numbers). `-v` adds packet counters. On a fresh install, the chains are empty with a default ACCEPT policy.

To see the raw commands that would recreate the current ruleset:

```bash
sudo iptables-save
```

This is useful for backing up rules and for understanding exactly what's configured.

## Rule anatomy

```bash
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
```

Read it left to right:

- `-A INPUT`: Append this rule to the INPUT chain
- `-p tcp`: Match TCP protocol
- `--dport 22`: Match destination port 22 (SSH)
- `-j ACCEPT`: Jump to ACCEPT (let the packet through)

You can insert a rule at a specific position:

```bash
sudo iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT
```

`-I INPUT 1` inserts at position 1, so it gets evaluated before everything else.

The three targets you'll use:

- **ACCEPT**: Let it through
- **DROP**: Silently discard (the sender gets no response)
- **REJECT**: Discard and send an error back

Use DROP for firewalls. REJECT tells the other side that your server exists and is actively refusing the connection. That's information you might not want to share.

## Building a basic ruleset

Here's what I set up on a web server. I'll walk through each rule:

```bash
# Allow packets belonging to existing connections
sudo iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# Allow loopback traffic
sudo iptables -A INPUT -i lo -j ACCEPT

# Allow SSH
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT

# Allow HTTP and HTTPS
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT

# Block everything else
sudo iptables -P INPUT DROP
```

The first rule is the most important one and the one people forget. `ESTABLISHED,RELATED` allows return traffic for connections you initiated. Without it, you accept the SSH connection but drop the responses. Everything works for one packet and then dies.

The loopback rule lets your machine talk to itself. Lots of services (databases, caches, local APIs) communicate over localhost. Block loopback and things break in confusing ways.

The last line sets the default policy. `DROP` means anything not explicitly allowed gets blocked. This is the right default for an internet-facing server: deny everything, open only what you need.

Order matters. The ESTABLISHED rule goes first so return traffic is processed immediately without checking every other rule.

## Saving rules

iptables rules vanish on reboot. Save them:

```bash
# Debian/Ubuntu
sudo iptables-save > /etc/iptables/rules.v4

# CentOS/RHEL
sudo service iptables save
```

Or install iptables-persistent to auto-restore rules on boot:

```bash
sudo apt install iptables-persistent
```

It asks during installation if you want to save current rules. Say yes.

## Deleting and modifying rules

List rules with line numbers:

```bash
sudo iptables -L INPUT -n --line-numbers
```

Delete by number:

```bash
sudo iptables -D INPUT 3
```

Delete rule 3 from the INPUT chain.

Flush everything (start over):

```bash
sudo iptables -F
```

Be careful: if your default policy is DROP and you flush all rules, you just blocked everything including your SSH session. Change the policy to ACCEPT first, then flush, then rebuild.

## Blocking an IP

```bash
sudo iptables -A INPUT -s 192.168.1.100 -j DROP
```

Block a whole subnet:

```bash
sudo iptables -A INPUT -s 10.0.0.0/8 -j DROP
```

Block outbound traffic to an IP:

```bash
sudo iptables -A OUTPUT -d 192.168.1.100 -j DROP
```

## Rate limiting SSH

Brute-force SSH attacks are constant on any public server. This limits new SSH connections to 3 per 60 seconds from the same IP:

```bash
sudo iptables -A INPUT -p tcp --dport 22 -m conntrack --ctstate NEW -m recent --set
sudo iptables -A INPUT -p tcp --dport 22 -m conntrack --ctstate NEW -m recent --update --seconds 60 --hitcount 4 -j DROP
```

The fourth attempt in 60 seconds gets dropped. Adjust to taste. (Also consider key-only authentication and disabling password login entirely.)

## Port forwarding

Forward port 8080 to another machine's port 80:

```bash
sudo iptables -t nat -A PREROUTING -p tcp --dport 8080 -j DNAT --to-destination 192.168.1.50:80
sudo iptables -A FORWARD -p tcp -d 192.168.1.50 --dport 80 -j ACCEPT
```

Enable IP forwarding (disabled by default):

```bash
echo 1 | sudo tee /proc/sys/net/ipv4/ip_forward
```

Make it permanent in `/etc/sysctl.conf`:

```
net.ipv4.ip_forward=1
```

## Logging dropped packets

For debugging, log what iptables blocks:

```bash
sudo iptables -A INPUT -j LOG --log-prefix "IPTABLES-DROP: "
sudo iptables -A INPUT -j DROP
```

Logs go to `/var/log/kern.log` or `/var/log/messages`.

Be selective in production. Logging every dropped packet on a server under attack fills your disk fast. Log specific traffic instead:

```bash
sudo iptables -A INPUT -p tcp --dport 23 -j LOG --log-prefix "TELNET-ATTEMPT: "
sudo iptables -A INPUT -p tcp --dport 23 -j DROP
```

## A complete example

Server running SSH, web traffic, and MySQL accessible only from the local network:

```bash
# Flush
sudo iptables -F

# Policies
sudo iptables -P INPUT DROP
sudo iptables -P FORWARD DROP
sudo iptables -P OUTPUT ACCEPT

# Established connections
sudo iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# Loopback
sudo iptables -A INPUT -i lo -j ACCEPT

# SSH
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT

# Web
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT

# MySQL from local network only
sudo iptables -A INPUT -p tcp --dport 3306 -s 192.168.1.0/24 -j ACCEPT

# Log and drop the rest
sudo iptables -A INPUT -j LOG --log-prefix "IPTABLES-DROP: "
sudo iptables -A INPUT -j DROP
```

This is a working, production-ready ruleset. It allows SSH from anywhere, web traffic from anywhere, database traffic from the local network, and blocks everything else with logging.

## The mistakes I've made

**Forgetting the ESTABLISHED rule.** Everything seems to work for a second and then breaks. Return traffic gets blocked. Always add this rule first.

**Setting DROP policy before adding allow rules.** The moment the policy changes, everything not explicitly allowed is blocked. Add your allow rules first, then set the policy.

**Not saving rules.** I've done this more than I'd like to admit. Server reboots for a kernel update, comes back up with no firewall rules. `iptables-save` after every change.

**Flushing rules with a DROP policy.** Changed the policy to ACCEPT first, then flush. Otherwise you're locked out the instant the flush runs.

## What about nftables and firewalld?

iptables works. It's showing its age, but it works. nftables is its successor in newer kernels with a cleaner syntax. firewalld provides a higher-level interface. UFW is Ubuntu's simplified frontend.

For a single server, any of these work. For complex setups, nftables scales better. For managed infrastructure (Ansible, Puppet, Chef), the tool usually abstracts the backend.

But the concepts are the same across all of them: chains, rules, policies, targets. Learning iptables teaches you how Linux packet filtering works at a fundamental level. That knowledge transfers to every other tool.

iptables does one thing: it filters packets. The commands are long, the syntax is verbose, and the man page is a wall of text. But the logic is simple: match a packet, decide what to do with it. Start with a basic ruleset, save it, and build from there.
