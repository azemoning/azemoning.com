---
title: "Disk management with LVM"
slug: "disk-management-with-lvm"
date: 2018-03-03
category: "Linux"
tags: ["linux", "lvm", "storage", "administration"]
readingTime: "9 min read"
excerpt: "Logical Volume Management: resizing partitions without reboots, adding disks on the fly, and snapshots."
---

It's 4 AM (why is it always the middle of the night?). You get an alert: `/data` is 98% full. The database can't write, the application is throwing errors, and users are seeing 500s.

You SSH in and check. The partition is 100GB. The database has grown. You need more space, and you need it now. If you set up the server with plain partitions, you're looking at: buy a bigger disk, boot from a rescue image, resize or copy the partition, hope nothing breaks, reboot. That's a midnight maintenance window on a good day.

If you set up the server with LVM, it's this:

```bash
sudo lvextend -r -L +50G /dev/datavg/datalv
```

Done. The logical volume is 50GB bigger. The filesystem expanded to fill it. No reboot, no downtime, no rescue image. That's why you use LVM.

<!-- truncate -->

## What LVM actually is

LVM (Logical Volume Manager) sits between your physical disks and your filesystems. Instead of formatting a partition directly, you build a three-layer stack:

1. **Physical volumes (PV)** , actual disks or partitions
2. **Volume groups (VG)** , pools of storage made from one or more PVs
3. **Logical volumes (LV)** , virtual partitions carved out of VGs

Think of it as: disks become a storage pool, and you carve slices from the pool. The slices can be bigger than any single disk, and you can resize them while the system is running.

It adds a layer of complexity. But the flexibility pays for itself the first time you need to resize something.

## Setting it up

Create a physical volume on a partition (use `fdisk` or `parted` to create the partition first, type `8e` for LVM):

```bash
sudo pvcreate /dev/sdb1
```

Create a volume group from it:

```bash
sudo vgcreate datavg /dev/sdb1
```

Create a logical volume:

```bash
sudo lvcreate -L 50G -n datalv datavg
```

Format and mount:

```bash
sudo mkfs.ext4 /dev/datavg/datalv
sudo mount /dev/datavg/datalv /data
```

Make it persistent across reboots:

```
# /etc/fstab
/dev/datavg/datalv /data ext4 defaults 0 2
```

That's the basic setup. The naming convention (`/dev/vgname/lvname`) takes some getting used to but it's consistent.

## Inspecting your setup

You'll use these commands a lot:

```bash
sudo pvs          # physical volumes (short)
sudo pvdisplay    # physical volumes (detailed)

sudo vgs          # volume groups (short)
sudo vgdisplay    # volume groups (detailed)

sudo lvs          # logical volumes (short)
sudo lvdisplay    # logical volumes (detailed)
```

The short forms (`pvs`, `vgs`, `lvs`) are good for quick checks. The display commands show everything: sizes, free space, the mapping between layers.

## Growing a logical volume

This is the happy path and the main reason LVM exists:

```bash
sudo lvextend -L +20G /dev/datavg/datalv
```

The LV is now 20GB bigger. But the filesystem doesn't know yet. Resize it:

```bash
sudo resize2fs /dev/datavg/datalv
```

Or do both in one command with `-r`:

```bash
sudo lvextend -r -L +20G /dev/datavg/datalv
```

The `-r` flag calls resize2fs automatically. Use it. It works while the filesystem is mounted. No downtime.

You can also extend to use all remaining free space in the VG:

```bash
sudo lvextend -r -l +100%FREE /dev/datavg/datalv
```

## Shrinking a logical volume

This is the scary path. Shrinking requires unmounting the filesystem, and you must shrink the filesystem before shrinking the LV. Get the order wrong and you lose data.

```bash
sudo umount /data
sudo e2fsck -f /dev/datavg/datalv     # filesystem check FIRST
sudo resize2fs /dev/datavg/datalv 30G  # shrink filesystem to 30G
sudo lvreduce -L 30G /dev/datavg/datalv  # shrink LV to 30G
sudo mount /dev/datavg/datalv /data
```

Always run `e2fsck` before shrinking. Shrinking a dirty filesystem corrupts it. And never shrink the LV smaller than the filesystem. That's instant data loss.

Growing is safe and easy. Shrinking is risky and requires downtime. Plan your initial sizes to be generous.

## Adding a disk to a volume group

When the VG runs out of space, add another physical disk:

```bash
sudo pvcreate /dev/sdc1
sudo vgextend datavg /dev/sdc1
```

Now the VG has more space. You can extend any LV in it:

```bash
sudo lvextend -r -L +50G /dev/datavg/datalv
```

The LV can now span across `/dev/sdb1` and `/dev/sdc1`. LVM handles the mapping transparently. The filesystem doesn't care that it's on two physical disks.

## Removing a disk from a volume group

This is harder. You need to move all data off the disk first:

```bash
sudo pvmove /dev/sdb1
```

`pvmove` migrates all physical extents from `/dev/sdb1` to other PVs in the VG. It can take a while depending on how much data needs to move. Once it's done:

```bash
sudo vgreduce datavg /dev/sdb1
sudo pvremove /dev/sdb1
```

Now `/dev/sdb1` is no longer part of the VG and you can remove or repurpose the disk.

## Snapshots

LVM snapshots capture the state of an LV at a point in time. This is useful for backups of live databases or for creating a consistent copy of a filesystem while it's being written to.

Create a snapshot:

```bash
sudo lvcreate -L 5G -s -n datalv_snap /dev/datavg/datalv
```

`-s` makes it a snapshot. `-L 5G` sets the snapshot size. This isn't the size of the copy, it's the space for tracking changes to the original. If the original changes more than 5GB while the snapshot exists, the snapshot is invalidated.

Mount it:

```bash
sudo mount /dev/datavg/datalv_snap /mnt/snapshot
```

Back it up, then clean up:

```bash
sudo umount /mnt/snapshot
sudo lvremove /dev/datavg/datalv_snap
```

Size the snapshot based on how much you expect to change during the backup. For a database that writes a lot during backup, give it more space. If you undersize it and the snapshot fills up, it becomes useless.

## Thin provisioning

With thin provisioning, you can create LVs larger than the actual available space. The VG allocates physical space on demand as data is written.

Create a thin pool:

```bash
sudo lvcreate -L 100G --thinpool thinpool datavg
```

Create thin volumes from it:

```bash
sudo lvcreate -V 200G --thin -n thinvolume1 datavg/thinpool
```

This creates a 200G logical volume backed by a 100G pool. It works as long as actual usage stays under the pool size. If you overcommit and usage exceeds the pool, things break in bad ways.

Monitor usage closely:

```bash
sudo lvs -o+data_percent,metadata_percent
```

Thin provisioning is useful in environments where you're allocating many VMs or containers and don't expect them all to use their full allocation. For a single server with a database, regular thick provisioning is simpler and safer.

## Why bother with all this

If you partitioned your disks directly, you can't resize without unmounting, repartitioning, and probably rebooting. LVM adds a few commands to the initial setup but gives you the ability to grow storage while the system is running. For any server that might need more storage later (and they all do, eventually), it's worth starting with LVM from the beginning.

The three-layer model (PV, VG, LV) is the kind of abstraction that feels unnecessary until the first time you use it. Then you wonder how you lived without it.
