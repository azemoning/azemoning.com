---
title: "Understanding PAM authentication"
slug: "understanding-pam-authentication"
date: 2022-02-17
category: "Linux"
tags: ["linux", "pam", "authentication", "security"]
readingTime: "7 min read"
excerpt: "How Linux authentication works under the hood. PAM modules, configuration files, and common customizations."
---

What actually happens between typing your password and seeing a shell prompt?

Most Linux admins interact with authentication every day without thinking about it. You type a password, the system checks it, you're in. But there's a whole framework sitting between your keyboard and that shell prompt, and it's more configurable than most people realize.

That framework is PAM: Pluggable Authentication Modules. Understanding it means you can enforce password policies, lock accounts after failed attempts, restrict login times, and integrate two-factor authentication, all without modifying the applications themselves.

<!-- truncate -->

## The four management groups

PAM splits authentication into four concerns:

- **auth** — Are you who you claim to be? (password check, biometric, token)
- **account** — Are you allowed in right now? (account expired? time restrictions? locked?)
- **password** — Handle password changes (complexity rules, history)
- **session** — Set up the environment after successful login (mount home dir, set resource limits, log the access)

Every service that uses PAM has a stack of modules for each group. When you log in, PAM runs through the stacks in order. Each module either succeeds, fails, or says "I don't care" (optional).

## The configuration files

PAM configs live in `/etc/pam.d/`. Each service gets its own file:

- `/etc/pam.d/login` — console login
- `/etc/pam.d/sshd` — SSH
- `/etc/pam.d/sudo` — sudo
- `/etc/pam.d/common-auth` — shared auth rules (included by other files)

A config line looks like this:

```
auth    required    pam_unix.so
```

Four fields: module-type (`auth`), control-flag (`required`), module-path (`pam_unix.so`), and optional arguments.

## Control flags (the confusing part)

This is where most people get tripped up:

- **required** — Must succeed. If it fails, authentication fails. But PAM continues checking other modules before returning the failure. (This is to avoid leaking information about which specific module failed.)
- **requisite** — Must succeed. If it fails, authentication fails immediately. No further checks.
- **sufficient** — If this succeeds and no prior `required` module has failed, authentication succeeds immediately. No need to check further.
- **optional** — This module's result only matters if it's the only module in the stack.
- **include** — Pull in another config file's rules.

The difference between `required` and `requisite` is subtle but important. Both cause failure when they fail. The difference is timing: `required` lets the rest of the stack run first, `requisite` stops immediately.

## Common modules

**pam_unix.so** — The standard. Checks the password against `/etc/shadow`. This is what most systems use for basic password authentication.

```
auth required pam_unix.so
```

**pam_permit.so** — Always succeeds. Used when you want to allow something without checking. Sounds weird but it's useful as a default.

**pam_deny.so** — Always fails. Put it at the end of a stack as a default-deny policy.

**pam_limits.so** — Sets resource limits from `/etc/security/limits.conf`. Think max open files, max processes, that sort of thing.

**pam_env.so** — Sets environment variables from `/etc/security/pam_env.conf`.

## Password policies

Want to enforce minimum password length and complexity? Edit `/etc/pam.d/common-password`:

```
password requisite pam_pwquality.so retry=3 minlen=12 difok=3
```

- `minlen=12` — minimum 12 characters
- `difok=3` — at least 3 characters must differ from the old password
- `retry=3` — three attempts before giving up

Account lockout after failed attempts, in `/etc/pam.d/common-auth`:

```
auth required pam_tally2.so deny=5 onerr=fail unlock_time=900
```

Five failed attempts locks the account for 15 minutes (900 seconds). Check the tally:

```bash
sudo pam_tally2 --user username
```

Reset it:

```bash
sudo pam_tally2 --user username --reset
```

## Restricting login times

Limit when users can log in via `/etc/security/access.conf`:

```
# Allow admin users from anywhere
+ : admin : ALL

# Allow everyone from local console
+ : ALL : LOCAL

# Deny everyone else
- : ALL : ALL
```

Enable this in the PAM config for the service:

```
account required pam_access.so
```

You can also restrict SSH access to specific users this way. Add `account required pam_access.so` to `/etc/pam.d/sshd`, then in `/etc/security/access.conf`:

```
+ : deploy : ALL
+ : admin : ALL
- : ALL : ALL
```

Only `deploy` and `admin` can SSH in. Everyone else is denied.

## The common-* include pattern

Most service configs include shared rules:

```
@include common-auth
@include common-account
@include common-password
@include common-session
```

These `common-*` files hold the rules that apply to all services. When you edit `common-auth`, you're changing auth behavior for everything that includes it.

This is convenient but also dangerous: a mistake in `common-auth` affects login, sudo, SSH, and everything else. Which brings us to the most important safety rule.

## The safety rule

**Always keep a root session open when editing PAM configs.**

A bad PAM config can lock everyone out. If you're editing over SSH and you break PAM, you lose your session and can't get back in. Keep a separate root shell open as a safety net. If something goes wrong, you can fix it from that shell.

I've seen this happen. It's not fun. Console access (physical or IPMI) is the only recovery option if you don't have a backup session.

## Things that go wrong

**Editing the wrong file.** Each service has its own PAM config. Changes to `/etc/pam.d/login` don't affect SSH. Changes to `/etc/pam.d/sshd` don't affect sudo. Check which file corresponds to the service you're trying to configure.

**Removing the common-* includes.** Many service configs start with `@include common-auth`. Remove that, and standard password authentication breaks for that service.

**Module ordering.** PAM evaluates modules top to bottom. A `sufficient` module before a `required` module can short-circuit the check. Think carefully about the order.

**Not testing with a non-critical account first.** Before rolling out a new PAM policy to production, test it on an account you can afford to lose access from. Or keep that root session open.

## What PAM is good for

Once you understand the module system, you can do a lot:

- Enforce password complexity and rotation
- Lock accounts after failed attempts
- Restrict logins by time, IP, or user
- Add two-factor authentication (pam_google_authenticator)
- Set resource limits per user or group
- Log all authentication events

The system ships with sensible defaults. Most of the time, you don't need to change anything. But when you do need to enforce a policy, PAM is where it happens. The framework is powerful, the configuration is order-sensitive, and mistakes can lock you out. Proceed carefully.
