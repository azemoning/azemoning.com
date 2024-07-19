---
slug: nginx-on-ubuntu-18-04
title: Quick Start with NGINX on Ubuntu 18.04
authors: upi
tags: [linux, server, web, nginx]
---

NGINX (pronounced "engine-x")  is a web server renowned for its speed, efficiency, and ability to handle high traffic volumes. If you're looking to host a website or application on Ubuntu 18.04, NGINX is an excellent choice. This comprehensive guide will walk you through the installation process, firewall configuration, basic testing, and essential server block setup. We'll also delve into some additional considerations to optimize your NGINX experience.

<!-- truncate -->


## Prerequisites

An Ubuntu 18.04 server with SSH access
A basic understanding of Linux commands

:::warning
Use command with caution.
:::


## Installation

### Update package lists

```bash
sudo apt update
```

This command ensures your system has the latest information about available software packages.



### Install NGINX

```bash
sudo apt install nginx
```

This command retrieves and installs the latest NGINX package from the Ubuntu repositories.

### Verifying Installation

Once the installation is complete, you can verify that NGINX is running using the following command:

```bash
sudo systemctl status nginx
```

This command should display output indicating that NGINX is active (running) and enabled.

## Firewall Configuration

By default, Ubuntu 18.04 might use UFW (Uncomplicated Firewall) to manage incoming connections. To allow access to NGINX through the firewall, you can use the following command:

```bash
sudo ufw allow http
```

This command opens port 80 (the standard HTTP port) for incoming traffic.

## Testing NGINX

Now that NGINX is installed and configured with the firewall, you can test it by opening a web browser and navigating to your server's IP address. If everything is set up correctly, you should see the default NGINX welcome page.

## Setting Up Server Blocks (Optional but Recommended)

The default NGINX configuration serves content from the ```/var/www/html``` directory. This is fine for a simple setup, but for hosting multiple websites or applications, you'll need to configure server blocks. 

Server blocks define virtual hosts, allowing you to serve different content from different locations on your server based on the domain name or IP address.

### Create a server block file

```bash
sudo nano /etc/nginx/sites-available/your_domain.conf
```

Replace your_domain.conf with your desired domain name.

Paste the following configuration into the file, replacing the placeholders:

```conf jsx title="/etc/nginx/sites-available/your_domain.conf"
server {
    listen 80;  # Adjust port if needed
    server_name your_domain.com;  # Replace with your domain name

    # Document root location
    root /path/to/your/website/content;

    # Index file to serve when a directory is requested
    index index.html index.htm;

    location / {
        # Add directives for serving static content, caching, etc.
    }
}
```
:::info
Don't forget to change ```your_domain```.conf and ```your_domain```.com with your desired domain name.
:::

Enable the server block:

```bash
sudo ln -s /etc/nginx/sites-available/your_domain.conf /etc/nginx/sites-enabled/your_domain.conf
```

Test the configuration:

```bash
sudo nginx -t
```

This command checks the syntax of your server block configuration for errors.

Reload NGINX:

```bash
sudo systemctl reload nginx
```

This command applies the changes you made to the server block configuration.

## Additional Considerations

### Permissions 
Ensure the user running NGINX (usually www-data) has read permissions for your website's content directory.

### SSL/TLS
For secure communication, consider installing and configuring SSL/TLS certificates on your server.

### Security 
Regularly update NGINX and the underlying Ubuntu system to address security vulnerabilities.


## Remarks
By following these steps, you'll have a basic NGINX web server up and running on your Ubuntu 18.04 system. Remember to consult the official NGINX documentation for more advanced configuration options and best practices.