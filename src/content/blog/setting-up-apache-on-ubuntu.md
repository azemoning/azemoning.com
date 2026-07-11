---
title: "Setting up Apache on Ubuntu"
slug: "setting-up-apache-on-ubuntu"
date: 2021-02-23
category: "Linux"
tags: ["linux", "apache", "web-server", "ubuntu"]
readingTime: "7 min read"
excerpt: "Installing and configuring Apache. Virtual hosts, .htaccess, modules, and the settings you'll want to change."
---

Apache or Nginx? Everyone has an opinion. Here's mine: Apache is the right pick when you need .htaccess support, when your application expects it (WordPress with certain plugins, legacy PHP apps), or when you want a module system that doesn't require recompilation. Nginx wins on raw performance for static content and reverse proxying. Both are production-grade. Pick based on your workload, not based on what Hacker News is excited about this week.

<!-- truncate -->

If you're going with Apache, here's how to set it up properly on Ubuntu.

## Install and verify

```bash
sudo apt install apache2
sudo systemctl enable apache2
sudo systemctl start apache2
```

Hit it with curl to confirm:

```bash
curl -I localhost
```

You should get a `200 OK` with the Apache version header. The default page lives at `/var/www/html/index.html`.

## The directory layout

Apache on Ubuntu uses a split configuration approach. The main config is `/etc/apache2/apache2.conf`, but you rarely edit it directly. Instead:

- **sites-available/** and **sites-enabled/** control virtual hosts
- **mods-available/** and **mods-enabled/** control modules
- **conf-available/** and **conf-enabled/** control global configuration snippets

The `sites-enabled/` directory contains symlinks to files in `sites-available/`. Same pattern for mods and conf. Ubuntu ships helper commands for managing these:

```bash
sudo a2ensite mysite.conf    # enable a site
sudo a2dissite mysite.conf   # disable a site
sudo a2enmod rewrite         # enable a module
sudo a2dismod status         # disable a module
```

After any change:

```bash
sudo systemctl reload apache2
```

## Virtual hosts

One server, multiple sites. That's what virtual hosts are for.

Create a config file:

```bash
sudo nano /etc/apache2/sites-available/mysite.conf
```

```apache
<VirtualHost *:80>
    ServerName mysite.com
    ServerAlias www.mysite.com
    DocumentRoot /var/www/mysite

    <Directory /var/www/mysite>
        AllowOverride All
        Require all granted
    </Directory>

    ErrorLog ${APACHE_LOG_DIR}/mysite-error.log
    CustomLog ${APACHE_LOG_DIR}/mysite-access.log combined
</VirtualHost>
```

Enable it and disable the default:

```bash
sudo a2ensite mysite.conf
sudo a2dissite 000-default.conf
sudo systemctl reload apache2
```

The `AllowOverride All` line is what enables `.htaccess` files in that directory. I'll get to that.

## Modules

Apache's functionality lives in modules. You enable what you need and leave the rest off. Every loaded module is a small performance cost and a potential attack surface.

The ones I enable on almost every server:

```bash
sudo a2enmod rewrite     # URL rewriting (WordPress, Laravel, most frameworks)
sudo a2enmod ssl         # HTTPS
sudo a2enmod headers     # HTTP header manipulation
sudo a2enmod expires     # cache control headers
sudo a2enmod proxy       # reverse proxy
sudo a2enmod proxy_http  # proxy to HTTP backends
```

Restart after enabling modules:

```bash
sudo systemctl restart apache2
```

## .htaccess

This is Apache's per-directory configuration mechanism. You drop a `.htaccess` file in a directory and it controls behavior for that directory and below. The catch: Apache reads `.htaccess` on every request. That's overhead.

A typical `.htaccess` for a PHP application:

```apache
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^(.*)$ index.php/$1 [L]
```

For HTTPS redirects:

```apache
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
```

Block access to `.htaccess` itself (good practice):

```apache
<Files ".htaccess">
    Require all denied
</Files>
```

My take: use `.htaccess` when you have to (shared hosting, applications that manage their own rewrite rules). For anything you control, move those rules into the virtual host config. The performance difference matters at scale.

## Security

Disable directory listing (nobody should see a file listing when they hit a directory without an index file):

```apache
<Directory /var/www/mysite>
    Options -Indexes
</Directory>
```

Hide your Apache version in response headers:

```
ServerTokens Prod
ServerSignature Off
```

Add that to `/etc/apache2/conf-enabled/security.conf`.

Disable modules you don't use. Run `apache2ctl -M` to see what's loaded. If you don't recognize a module, look it up before disabling it. Common ones to turn off: `status`, `info`, `autoindex`.

## HTTPS

Install certbot and the Apache plugin:

```bash
sudo apt install certbot python3-certbot-apache
```

Get a certificate:

```bash
sudo certbot --apache -d mysite.com -d www.mysite.com
```

Certbot modifies your Apache config to add the SSL virtual host and redirects HTTP to HTTPS. Test that renewal works:

```bash
sudo certbot renew --dry-run
```

## Performance

Check which MPM (Multi-Processing Module) you're using:

```bash
apache2ctl -V | grep MPM
```

Ubuntu defaults to `mpm_event`, which is good. If you're on `mpm_prefork` (process-based, one process per connection), consider switching. `mpm_event` uses threads and handles keep-alive connections much more efficiently.

Tune `KeepAlive`:

```
KeepAlive On
MaxKeepAliveRequests 100
KeepAliveTimeout 5
```

`KeepAliveTimeout 5` means the server waits 5 seconds for the next request on a persistent connection before closing it. Lower it if you have many concurrent connections and limited resources.

## Logs

Access log: `/var/log/apache2/access.log`
Error log: `/var/log/apache2/error.log`

Watch requests in real time:

```bash
sudo tail -f /var/log/apache2/access.log
```

Each virtual host can have its own log files (as shown in the virtual host config above). This makes debugging much easier when you're hosting multiple sites.

## When Apache breaks

**403 Forbidden:** Usually a permissions issue. Apache's user (`www-data`) needs read access to the document root. Check with `ls -la /var/www/mysite/`. Also check that the directory has an index file or `Options +Indexes` is set (though you probably don't want directory listing enabled).

**Config syntax error:** `sudo apache2ctl configtest` before reloading. It catches syntax errors without restarting.

**Site not loading after enabling:** Make sure you created the symlink with `a2ensite` and reloaded Apache. Also check that the `ServerName` doesn't conflict with another virtual host.

Apache has been around since 1995 and it shows: the documentation is extensive, the configuration is verbose but well-structured, and almost every problem has been solved by someone before you. The `a2ensite`/`a2enmod` system on Ubuntu makes day-to-day management painless. Set up your virtual hosts, enable only the modules you need, and it'll run for years without fuss.
