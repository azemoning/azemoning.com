---
title: "Managing SSL certificates with Let's Encrypt"
slug: "managing-ssl-certificates-with-lets-encrypt"
date: 2019-04-03
category: "Linux"
tags: ["linux", "ssl", "lets-encrypt", "certbot", "https", "security"]
readingTime: "6 min read"
excerpt: "Getting free SSL certificates with Let's Encrypt and certbot. Installation, renewal, and troubleshooting."
---

Running HTTP in 2024 is negligent. Browsers warn visitors. Search engines penalize you. Any data your users send (passwords, form submissions, cookies) travels in plaintext. There's no technical reason for it: Let's Encrypt gives you free certificates with automatic renewal. The barrier to HTTPS is zero.

<!-- truncate -->

This post covers getting certificates with certbot, handling renewal, and the things that trip people up.

## How Let's Encrypt works

Let's Encrypt uses the ACME protocol. The basic flow:

1. Certbot (your client) asks Let's Encrypt for a certificate for your domain
2. Let's Encrypt says "prove you control this domain"
3. Certbot puts a challenge file on your web server
4. Let's Encrypt fetches that file to verify
5. Certificate issued

The challenge happens over HTTP (port 80) for the standard method. This is why port 80 needs to be reachable even if you only serve HTTPS. Let's Encrypt also needs your DNS to resolve to your server's IP before you request the cert.

## Getting your first certificate

Install certbot with the plugin for your web server:

```bash
# Apache
sudo apt install certbot python3-certbot-apache

# Nginx
sudo apt install certbot python3-certbot-nginx
```

For Apache:

```bash
sudo certbot --apache -d example.com -d www.example.com
```

For Nginx:

```bash
sudo certbot --nginx -d example.com -d www.example.com
```

Certbot modifies your web server config to use the certificate and adds an HTTP-to-HTTPS redirect. You go from zero to fully HTTPS in one command.

If you don't want certbot touching your web server config:

```bash
sudo certbot certonly --webroot -w /var/www/html -d example.com
```

This gets the certificate and puts it in `/etc/letsencrypt/live/example.com/`. You configure your web server manually. Useful when you have a non-standard setup or want full control.

For servers that aren't running a web server (mail server, database server):

```bash
sudo certbot certonly --standalone -d example.com
```

Certbot starts its own temporary web server on port 80 for the challenge. This stops your regular web server if one is running on that port, so use the webroot or plugin method instead if you have a web server.

## Where certificates live

```
/etc/letsencrypt/live/example.com/
    fullchain.pem    # certificate + intermediate chain
    privkey.pem      # private key
    cert.pem         # just the certificate
    chain.pem        # just the intermediate chain
```

Your web server needs `fullchain.pem` and `privkey.pem`. That's it. The symlinks in `live/` always point to the latest certificate, so your config doesn't need to change when certs renew.

## Renewal

This is the part people forget. A certificate is only useful if it stays valid. Let's Encrypt certificates expire after 90 days.

Certbot installs a systemd timer that checks twice daily and renews certificates with 30 days or less remaining:

```bash
systemctl list-timers | grep certbot
```

Test that renewal works:

```bash
sudo certbot renew --dry-run
```

If this succeeds, you're set. If it fails, fix it now, not 89 days from now when your certificate expires on a Saturday night.

If you're using `certonly` (certbot doesn't manage your web server config), you need a post-renewal hook to reload your web server:

```bash
sudo certbot renew --deploy-hook "systemctl reload nginx"
```

Or put it in a renewal config file at `/etc/letsencrypt/renewal/example.com.conf`.

## Wildcard certificates

Cover all subdomains with one cert. Requires DNS-01 challenge (you add a TXT record to your DNS):

```bash
sudo certbot certonly --manual --preferred-challenges dns -d "*.example.com" -d example.com
```

Certbot tells you what TXT record to add. You add it, press Enter, cert verifies.

Manual renewal for wildcard certs is tedious. If your DNS provider has a certbot plugin (Cloudflare, Route53, DigitalOcean, and others do), use it for automated renewal:

```bash
sudo apt install python3-certbot-dns-cloudflare
```

Configure API credentials and certbot handles everything, including renewal.

## Multiple domains

One certificate, multiple names:

```bash
sudo certbot --nginx -d example.com -d www.example.com -d api.example.com -d blog.example.com
```

Or separate certificates per subdomain. Separate certs are easier to renew independently and limit the blast radius if one is compromised. For most cases, a single cert with multiple names is fine.

## Revoking a certificate

If the private key is compromised (server was breached, key was accidentally committed to a repo):

```bash
sudo certbot revoke --cert-path /etc/letsencrypt/live/example.com/cert.pem
```

Then get a new certificate immediately. Revoked certificates show up in Certificate Transparency logs and browsers will flag them.

## What goes wrong

**Port 80 blocked.** Cloud security groups, firewalls, and container networking can all block port 80 without you realizing it. Test from outside your network: `curl http://example.com/.well-known/acme-challenge/test`. If it doesn't reach your server, the challenge will fail.

**DNS not pointing to your server.** The domain must resolve to your server's IP before you request the cert. Check with `dig example.com`. If you just changed DNS, wait for propagation.

**Rate limits.** Let's Encrypt limits you to 50 certificates per registered domain per week and 5 duplicate certificates per week. If you're testing, use the staging environment:

```bash
sudo certbot --staging --nginx -d example.com
```

Staging certificates aren't trusted by browsers (they use a fake CA), but they don't count against your rate limits. Switch to production once everything works.

**Renewal fails silently.** The timer runs, certbot tries, something fails, and you don't notice until the cert expires. Set up monitoring for certificate expiry. A simple cron job works:

```bash
echo | openssl s_client -connect example.com:443 -servername example.com 2>/dev/null | openssl x509 -noout -dates
```

Or use `sudo certbot certificates` to check all managed certs.

**Certbot updated your config wrong.** It happens, especially with complex virtual host setups. Check the config after certbot runs. Use `nginx -t` or `apache2ctl configtest`.

**Standalone mode in production.** `certbot certonly --standalone` briefly stops your web server to bind port 80. Use the Apache or Nginx plugin for zero-downtime certificate operations. Standalone is for servers without a web server (mail, FTP).

The setup takes five minutes. The renewal is automatic. There is no good reason to run a web server without HTTPS. Get the cert, verify renewal works, and move on to things that require more thought.
