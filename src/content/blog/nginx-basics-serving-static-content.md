---
title: "Nginx basics: serving static content"
slug: "nginx-basics-serving-static-content"
date: 2019-07-18
category: "Linux"
tags: ["linux", "nginx", "web-server", "reverse-proxy"]
readingTime: "8 min read"
excerpt: "Setting up Nginx as a static file server and reverse proxy. Configuration basics, virtual hosts, and performance tuning."
---

10,000 concurrent connections. 5MB of memory usage. That's a real number from a production Nginx server I worked with, serving static files for a content-heavy site. No tuning, no magic, just Nginx doing what it was built to do. Apache, handling the same load, would have needed significantly more RAM because of its process-per-connection (or thread-per-connection) model.

<!-- truncate -->

Nginx uses an event-driven architecture. One master process spawns a handful of worker processes, and each worker handles thousands of connections through non-blocking I/O. The result is that memory usage scales with the number of unique requests, not the number of concurrent connections.

That's why Nginx became the default choice for high-traffic sites, reverse proxying, and load balancing. Here's how to set it up.

## Installation

```bash
sudo apt install nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

Verify it's running:

```bash
curl -I localhost
```

You should see `Server: nginx` in the response headers.

## Config structure

The main config is `/etc/nginx/nginx.conf`. You probably won't touch it much. Per-site configuration goes in:

- `/etc/nginx/sites-available/` (your config files)
- `/etc/nginx/sites-enabled/` (symlinks to enabled sites)
- `/etc/nginx/conf.d/` (additional config snippets)

This is the same pattern as Apache, though Nginx got there without the helper commands.

## Your first server block

```bash
sudo nano /etc/nginx/sites-available/mysite
```

```nginx
server {
    listen 80;
    server_name mysite.com www.mysite.com;
    root /var/www/mysite;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    access_log /var/log/nginx/mysite-access.log;
    error_log /var/log/nginx/mysite-error.log;
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/mysite /etc/nginx/sites-enabled/
sudo nginx -t                  # ALWAYS test first
sudo systemctl reload nginx
```

Remove the default site:

```bash
sudo rm /etc/nginx/sites-enabled/default
```

> [!WARNING]
> Always run `nginx -t` before reloading. A syntax error in any config file takes down ALL sites, not just the one you're editing. This is the single most common Nginx mistake.

## Location matching

Location blocks tell Nginx how to handle different URL patterns. The matching order is specific:

```nginx
location = /favicon.ico {
    # exact match, checked first
}

location ^~ /images/ {
    # prefix match, checked before regex
}

location ~* \.(js|css|png|jpg)$ {
    # regex match, case-insensitive
}

location / {
    # catch-all prefix match
}
```

The precedence: exact (`=`) first, then prefix matches with `^~` (longest wins), then regex matches (first match wins in order), then regular prefix matches (longest wins).

This matters when you're combining caching rules, proxy rules, and static file serving. Put specific locations before general ones.

## Reverse proxy

This is where Nginx really shines. Proxying to a backend application:

```nginx
server {
    listen 80;
    server_name app.mysite.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Without the `proxy_set_header` lines, your backend sees every request coming from `127.0.0.1`. The `X-Real-IP` and `X-Forwarded-For` headers pass the actual client IP through. Most application frameworks know how to read these.

## Static file caching

The whole point of this post. Serve static files with proper cache headers:

```nginx
server {
    listen 80;
    server_name static.mysite.com;
    root /var/www/static;

    location / {
        expires 30d;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

`expires` sets both the `Cache-Control` and `Expires` headers. Browsers cache the file and don't request it again until it expires. `immutable` tells the browser the file won't change (use versioned filenames for cache busting).

Turning off `access_log` for static assets saves disk I/O. You probably don't need to log every image request.

## Gzip

Compress text-based responses:

```nginx
gzip on;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
gzip_min_length 1000;
```

Don't gzip images or other binary formats that are already compressed. The CPU cost isn't worth the negligible size reduction. `gzip_min_length 1000` skips tiny responses where compression overhead exceeds the savings.

## HTTPS

```nginx
server {
    listen 443 ssl;
    server_name mysite.com;

    ssl_certificate /etc/letsencrypt/live/mysite.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mysite.com/privkey.pem;

    # ... your other config
}

server {
    listen 80;
    server_name mysite.com;
    return 301 https://$host$request_uri;
}
```

Or let certbot handle it:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d mymsite.com
```

Certbot modifies your config and adds the HTTPS block.

## Performance knobs

Worker processes (usually match your CPU cores):

```
worker_processes auto;
```

Connections per worker:

```
events {
    worker_connections 1024;
}
```

Total capacity = `worker_processes` × `worker_connections`. On a 4-core server with default settings, that's 4,096 concurrent connections. Bump `worker_connections` if you need more.

Open file cache (reduces syscall overhead for frequently accessed files):

```nginx
open_file_cache max=1000 inactive=20s;
open_file_cache_valid 30s;
open_file_cache_min_uses 2;
```

## Useful snippets

Rate limiting:

```nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

location /api/ {
    limit_req zone=api burst=20 nodelay;
    proxy_pass http://backend;
}
```

Custom error pages:

```nginx
error_page 404 /404.html;
error_page 500 502 503 504 /50x.html;
```

Blocking IPs:

```nginx
deny 192.168.1.100;
allow all;
```

## What goes wrong

**Config test passes but the site doesn't reload.** Nginx caches config in the worker processes. `systemctl reload` sends a signal to the master, which starts new workers with the new config. If the master isn't running (check with `systemctl status`), reload does nothing.

**502 Bad Gateway.** The backend isn't running or isn't listening on the port you specified in `proxy_pass`. Check with `curl http://127.0.0.1:3000` from the server itself.

**413 Request Entity Too Large.** The default upload limit is 1MB. Add `client_max_body_size 50m;` to your server or location block.

**Gzip not working.** Check that the `Content-Type` of the response matches one of your `gzip_types`. Also check that no proxy is stripping the `Accept-Encoding` header.

Nginx does a few things and does them extremely well. Static files, reverse proxying, load balancing. The config is clean, the performance is predictable, and the documentation is solid. Set up your server blocks, enable gzip, add cache headers for static assets, and you're in good shape. The `nginx -t` before reload habit will save you from the most common failure mode.
