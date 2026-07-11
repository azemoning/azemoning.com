---
title: "rsync: the Swiss Army knife of file sync"
slug: "rsync-the-swiss-army-knife-of-file-sync"
date: 2020-10-31
category: "Linux"
tags: ["linux", "rsync", "backup", "file-sync", "cli"]
readingTime: "7 min read"
excerpt: "Copying files efficiently with rsync. Local and remote sync, incremental backups, and the flags you'll actually use."
---

My first backup script used `cp`. It copied everything, every time. A directory with 200GB of files, and every night it would copy all 200GB to the backup location. It took about 2 hours. The server was slow during the backup. Everyone accepted this as normal.

Then someone showed me rsync. The same backup, the second night, took 30 seconds. Because only the files that changed got transferred. The rest were already there. I felt both grateful and slightly foolish for the months of wasted time.

<!-- truncate -->

## The core idea

rsync copies files, but it only transfers the differences. If a 10GB file changed by 1 byte, rsync sends the delta, not the whole file. This makes it fast for repeated syncs, especially over a network.

## Basic local usage

```bash
rsync -av /source/ /destination/
```

`-a` is "archive mode." It preserves permissions, timestamps, symlinks, owner, group, and device files. Basically everything you'd want to keep.

`-v` is verbose. You want this so you can see what's happening.

### The trailing slash

This is the number one rsync gotcha:

```bash
rsync -av /source/ /destination/   # copies contents of source INTO destination
rsync -av /source /destination/    # copies the source DIRECTORY into destination
```

With the trailing slash on `/source/`, rsync copies the contents. Without it, rsync copies the directory itself. Test with `-n` (dry run) until you're sure which behavior you want.

## Remote sync

rsync uses SSH for transport, so it works wherever SSH works:

```bash
rsync -av /local/data/ user@remote:/backup/data/    # push to remote
rsync -av user@remote:/var/www/ /local/backup/www/   # pull from remote
```

No special server setup needed. If you can SSH to the machine, you can rsync to it.

## Flags I actually use

```bash
rsync -avz /source/ /dest/         # compress during transfer (good for slow networks)
rsync -avP /source/ /dest/         # show progress + resume partial transfers
rsync -av --delete /source/ /dest/ # mirror: delete files at dest not in source
rsync -avn /source/ /dest/         # dry run: show what would happen without doing it
```

`-P` (uppercase) combines `--progress` and `--partial`. The partial flag keeps partially transferred files so you can resume if the connection drops. Without it, rsync starts the file over.

`--delete` makes the destination an exact mirror. Files at the destination that don't exist at the source get removed. Powerful and dangerous. Always dry-run first when using `--delete`.

## Excluding files

```bash
rsync -av --exclude='*.log' --exclude='.git' /source/ /dest/
```

For longer exclusion lists, use a file:

```bash
rsync -av --exclude-from='exclude.txt' /source/ /dest/
```

Where `exclude.txt` contains:

```
*.log
.git
node_modules
__pycache__
```

This is useful for syncing project directories without the junk.

## Incremental backups with hard links

This is the rsync trick that changed how I do backups:

```bash
#!/bin/bash
BACKUP_DIR="/backup/$(date +%Y-%m-%d)"
LATEST="/backup/latest"

rsync -av --delete \
    --link-dest="$LATEST" \
    /data/ "$BACKUP_DIR/"

rm -f "$LATEST"
ln -s "$BACKUP_DIR" "$LATEST"
```

Each run creates a new directory that looks like a complete backup. But unchanged files are hard links to the previous backup, so they take no extra disk space. Delete any single backup and the others remain intact.

You end up with daily snapshots that are browsable as complete directories. Recovery is just copying files from the date you want. No special restore tool needed.

## Bandwidth limiting

If you're syncing during business hours:

```bash
rsync -av --bwlimit=5000 /source/ user@remote:/dest/
```

This caps transfer at 5000 KB/s. Keeps the network usable for everyone else.

## Daemon mode

For high-frequency syncs to the same server, rsync daemon mode avoids the SSH overhead. On the server, configure `/etc/rsyncd.conf`:

```
[backup]
    path = /backup
    read only = no
    auth users = backupuser
    secrets file = /etc/rsyncd.secrets
```

Sync with:

```bash
rsync -av /data/ backupuser@server::backup/data/
```

The double colon triggers daemon mode. For most use cases, SSH mode is fine. Daemon mode is for when SSH overhead becomes measurable.

## Reading rsync output

rsync shows you what changed:

- `>f+++++++++` , new file
- `>f..t......` , timestamp changed
- `>f.st......` , size and timestamp changed
- `*deleting` , file removed at destination (with `--delete`)

The dots represent what changed: size, timestamp, permissions, etc. A line of dots means nothing changed for that attribute.

## Mistakes I've seen (and made)

**Trailing slash confusion.** I once synced a directory without the trailing slash and ended up with `/dest/source/` instead of `/dest/`. The files were all there, just one level too deep. Use `-n` first.

**`--delete` without a dry run.** A wrong source path with `--delete` can empty your destination. Always `rsync -avn --delete` before the real run. I can't stress this enough.

**Not using `-a`.** Without it, rsync doesn't preserve permissions, timestamps, or symlinks. `-a` is almost always what you want. I can't think of a time I didn't use it.

**Syncing live databases.** rsync copies files as they are. If a database is writing to its files, you get an inconsistent snapshot. Dump the database first or use LVM snapshots for consistent backups.

## rsync vs everything else

For one-way file sync, rsync is hard to beat. It's fast, reliable, available on every Linux system, and the interface is straightforward once you know the flags.

For two-way sync (like keeping a directory in sync between two machines that both edit files), look at tools like Syncthing or Unison. rsync is one-directional by design.

For backups with rotation and scheduling, rsync is the engine but you might want a wrapper script or a tool like restic that adds deduplication and encryption.

But for the basic use case, "copy the differences from A to B," rsync is the answer. It's been the answer for 20 years.
