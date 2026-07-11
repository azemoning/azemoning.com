---
title: "NFS: sharing files across Linux machines"
slug: "nfs-sharing-files-across-linux-machines"
date: 2019-05-17
category: "Linux"
tags: ["linux", "nfs", "networking", "file-sharing"]
readingTime: "7 min read"
excerpt: "Setting up NFS shares between Linux servers. Server configuration, client mounting, and performance tuning."
---

I had 5 web servers behind a load balancer, and they all needed access to the same uploaded files. Users upload images through any of the 5 servers, and those images need to be served by all of them. You could sync files between servers with rsync on a cron job, but that's fragile and there's always a delay. NFS was the answer: one server holds the files, the other 5 mount that directory.

NFS (Network File System) has been around since the 1980s. It's not fancy. But for sharing files between Linux machines on the same network, it's the simplest tool for the job.

<!-- truncate -->

## Setting up the server

Install the NFS server package:

```bash
sudo apt install nfs-kernel-server
```

Create the directory you want to share:

```bash
sudo mkdir -p /srv/nfs/shared
sudo chown nobody:nogroup /srv/nfs/shared
```

Configure which directories to share and with whom in `/etc/exports`:

```
/srv/nfs/shared 192.168.1.0/24(rw,sync,no_subtree_check)
```

This shares `/srv/nfs/shared` with every machine on the 192.168.1.0/24 subnet. The options:

- `rw` , read-write (use `ro` if you only need read access)
- `sync` , write to disk before replying to the client (safer, slightly slower)
- `no_subtree_check` , skip subtree verification (recommended, improves reliability)
- `root_squash` , the default; maps root on the client to nobody on the server. Keep this. It prevents a compromised client from owning the share.
- `no_root_squash` , lets root on the client be root on the share. Dangerous. Only use this if you fully trust every client machine.

Apply the exports and start the server:

```bash
sudo exportfs -ra
sudo systemctl enable nfs-kernel-server
sudo systemctl start nfs-kernel-server
```

## Mounting on the clients

Install the NFS client:

```bash
sudo apt install nfs-common
```

Check what shares are available on the server:

```bash
showmount -e nfs-server-ip
```

Mount the share:

```bash
sudo mount -t nfs nfs-server-ip:/srv/nfs/shared /mnt/shared
```

Make it permanent in `/etc/fstab`:

```
nfs-server-ip:/srv/nfs/shared /mnt/shared nfs defaults 0 0
```

After that, the share mounts automatically on boot. If the NFS server is down when the client boots, the mount will hang (or fail, depending on your fstab options). For that reason, you might want `soft` mounts or `bg` (background retry) for non-critical shares.

## Firewall

NFS uses several ports. The simplest approach:

```bash
sudo ufw allow from 192.168.1.0/24 to any port nfs
```

If you're using iptables directly, NFS needs port 2049 (nfs), 111 (rpcbind), and possibly others depending on the version. For fixed port numbers, configure `/etc/default/nfs-kernel-server` and `/etc/default/nfs-common`.

NFSv4 is easier to firewall because it only uses port 2049. If you can use NFSv4, do.

## Performance

Mount options that matter:

```
nfs-server:/share /mnt nfs rw,hard,intr,rsize=32768,wsize=32768 0 0
```

- `hard` , retry indefinitely if the server is unavailable. Use this for anything important. The alternative, `soft`, returns an error after a timeout and can cause data corruption.
- `intr` , lets you interrupt hung NFS operations (Ctrl+C works).
- `rsize`/`wsize` , read/write block sizes. Larger values mean better throughput on fast networks. 32768 is a good starting point.

For NFSv4:

```
nfs-server:/share /mnt nfs4 rw,hard,intr 0 0
```

NFSv4 is the modern version. Simpler firewall requirements, better security options (Kerberos support if you need it), and generally the right choice for new setups.

## Troubleshooting

When things don't work, check in this order:

Is the server running?

```bash
sudo systemctl status nfs-kernel-server
rpcinfo -p nfs-server-ip
```

What's exported?

```bash
sudo exportfs -v
```

Verbose mount for debugging:

```bash
sudo mount -v -t nfs nfs-server-ip:/srv/nfs/shared /mnt/shared
```

NFS statistics:

```bash
nfsstat -s    # server stats
nfsstat -c    # client stats
```

Stale file handles are a common issue. They happen when a file is deleted on the server while a client has it open. Fix: unmount and remount on the client.

## Security

A few things to keep in mind:

Use `root_squash` (the default). It's there for a reason.

Don't export to `*` (everyone). Restrict to specific IP ranges. If your servers are on 192.168.1.0/24, export to that range only.

For sensitive data, NFSv4 with Kerberos (`sec=krb5`) adds encryption and proper authentication.

Keep NFS traffic on your internal network. It was not designed for the internet.

## What I've seen go wrong

The most common mistake: using `no_root_squash`. Someone enables it because they need to write as root from a client, and then they forget to turn it off. If any client is compromised, the attacker has root access to the share.

The second most common: forgetting to run `exportfs -ra` after editing `/etc/exports`. The file is just a text file until you apply it. Changes don't take effect on their own.

The third: using `soft` mounts for anything that matters. A brief network hiccup causes data corruption. Use `hard` and `intr` together so operations retry but you can still interrupt them if needed.

One more thing: NFS is not a backup. If the NFS server's disk dies, the data is gone. NFS shares files, it doesn't protect them. You still need backups on the server side.
