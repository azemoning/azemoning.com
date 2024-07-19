---
slug: demystyfing-ssh
title: Demystyfying SSH
authors: upi
tags: [linux, server, ssh]
---

In the realm of system administration, secure remote access is paramount. This is where SSH, or Secure Shell, comes into play. SSH serves as a robust and encrypted protocol that allows you to connect to and manage your Ubuntu 18.04 server from a remote location. This blog post dives deep into the world of SSH, exploring its core functionalities, configuration steps for Ubuntu 18.04, and best practices to bolster your server's security.

<!-- truncate -->


## What is SSH and Why is it Secure?

SSH is a workhorse for remote server management. It establishes a secure channel between your local machine (SSH client) and the remote server (SSH server). Unlike its predecessor, Telnet, which transmits data in plain text, SSH safeguards communication by employing encryption techniques. This encryption scrambles the data being exchanged, rendering it unreadable to anyone snooping on the network. SSH utilizes a combination of public-key cryptography and secure hashing algorithms to authenticate users and ensure data integrity.

## Security Concerns with SSH (and How to Mitigate Them)

While SSH is inherently secure, there are potential vulnerabilities to consider:

- Weak Passwords: A strong, unique password is the first line of defense. Avoid dictionary words or easily guessable combinations.
- Brute-Force Attacks: Malicious actors might attempt to bombard your server with login attempts using automated tools. Enforce complex passwords and consider implementing login throttling mechanisms.
- Unsecured Public Keys: Public keys used for SSH authentication should be properly secured. Avoid placing them in world-readable locations.

## Prerequisites

- An Ubuntu 18.04 server
- Basic understanding of Linux commands

:::warning
Use command with caution.
:::


## Installing SSH on Ubuntu 18.04

SSH isn't always installed by default on Ubuntu 18.04. Here's how to install it if needed:

### Update package lists:

```bash
sudo apt update
```

### Install the SSH server package:

```bash
sudo apt install openssh-server
```

Enter your password when prompted, and the installation will commence.

## Connecting to a Remote Server with Password Authentication

Once SSH is installed and running, you can connect to your server from another machine using an SSH client. Here's an example using the built-in SSH client on most Linux distributions:

Open a terminal window on your local machine.

Type the following command, replacing username with your actual username on the remote server and server_ip with the server's IP address:

```bash
ssh username@server_ip
```

When prompted, enter your password for the remote server user account.

## The Power of SSH Keys

Password authentication, while convenient, introduces the risk of brute-force attacks. SSH keys offer a more secure alternative.  An SSH key pair consists of a public key and a private key. The public key resides on the server you want to access, while the private key stays on your local machine. During login, the SSH client sends your public key to the server, which verifies it against the authorized keys stored on the server. If a match is found, access is granted without requiring a password.

## Configuring SSH Keys

### Generate an SSH key pair

```bash
ssh-keygen
```

Follow the prompts, entering a secure passphrase when prompted. The generated key pair will be saved in the .ssh directory in your home directory (usually ```~/.ssh/id_rsa``` for the private key and ```~/.ssh/id_rsa.pub``` for the public key).

### Copy the public key to the remote server

There are several methods to achieve this. You can use the ssh-copy-id command:

```bash
ssh-copy-id username@server_ip
```

Enter your password for the remote server when prompted. This will copy your public key to the authorized_keys file on the server.

### Verify key-based authentication

Try connecting to the server again using SSH. You should be granted access without entering a password (assuming the key and passphrase match).

## Hardening SSH Access for Enhanced Security

Now that you've explored SSH key authentication, let's solidify your server's security posture

### Disable Password Authentication

Edit the SSH server configuration file (```/etc/ssh/sshd_config```) using a text editor like nano. Locate the line ```PasswordAuthentication yes``` and change it to ```PasswordAuthentication no```. 

Save the changes and restart the SSH service:

```bash
sudo systemctl restart ssh
```

:::warning
Disabling password authentication before setting up SSH keys will make the remote server **inaccessible!**
:::

## Advanced SSH Topics

### Port Forwarding 

SSH allows you to forward ports on your local machine to ports on the remote server. This can be useful for tunneling traffic or accessing services on the remote server that aren't directly accessible.
### Jump Servers

For complex network setups, you might utilize a jump server – an intermediate server that allows you to securely access other servers within a network.
### SSH Tunneling

Tunneling creates a secure channel within an SSH connection. This can be used to encrypt data sent over an otherwise unencrypted connection.
### SSH Config File (sshd_config)

The sshd_config file contains numerous options for customizing SSH server behavior. Explore the man page for sshd_config ( man sshd_config ) to delve deeper into these options.

## Securing Your SSH Configuration

### Disable Root Login

It's generally recommended to avoid logging in directly as the root user. Create a user account with sudo privileges for administrative tasks. Edit /etc/ssh/sshd_config and set PermitRootLogin no.
### Disable Empty Password

Ensure the line PermitEmptyPasswords no is present in /etc/ssh/sshd_config to prevent login attempts without a password.
Restrict Login Attempts: Consider using tools like fail2ban to limit login attempts and thwart brute-force attacks.
### Keep SSH Up-to-Date

Regularly update the SSH server package (openssh-server) to address security vulnerabilities.


## Remarks

Security is an ongoing process. By following best practices and staying informed about emerging threats, you can maintain a secure SSH environment for managing your Ubuntu 18.04 server.