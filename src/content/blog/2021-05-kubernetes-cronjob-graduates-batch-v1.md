---
title: "CronJob Finally Graduated to batch/v1 in Kubernetes 1.21"
slug: "kubernetes-cronjob-graduates-batch-v1"
date: 2021-05-18
category: "Kubernetes"
tags: ["kubernetes", "cronjob", "jobs", "batch", "scheduling"]
readingTime: "8 min read"
excerpt: "CronJobs are GA in Kubernetes 1.21. Here's what that means, and how Jobs and CronJobs actually work."
---

CronJob finally graduated to `batch/v1` in Kubernetes 1.21.

If you've been using `batch/v1beta1` for your scheduled tasks (and most of us have, since CronJobs have been in beta since Kubernetes 1.8), this means you can now use the stable API. The `v1beta1` version will stick around for a few releases, but it's on the deprecation clock. Time to update your manifests.

This is also a good moment to actually understand how CronJobs work, because they depend on Jobs, and Jobs have some behavior that catches people off guard.

<!-- truncate -->

## Jobs first: the foundation

A CronJob creates Jobs. So let's start there. A Job runs one or more pods to completion. Unlike a Deployment (which keeps pods running indefinitely and replaces them if they die), a Job's pods are expected to finish their work and exit.

Here's the simplest possible Job:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: hello-job
spec:
  template:
    spec:
      containers:
        - name: hello
          image: busybox:1.33
          command: ['sh', '-c', 'echo "Hello from the job" && sleep 10']
      restartPolicy: Never
```

Note the `restartPolicy: Never`. This is required for Jobs. (Pods created by Deployments default to `Always`, but Jobs must use `Never` or `OnFailure`.)

Run it and check:

```bash
kubectl apply -f hello-job.yaml
kubectl get jobs
kubectl get pods --selector=job-name=hello-job
```

The pod runs, prints its message, exits with code 0, and the Job marks it as complete.

## Job behavior that surprises people

**`restartPolicy: Never` vs `restartPolicy: OnFailure`.** With `Never`, if the pod fails (exit code non-zero), Kubernetes creates a new pod. The old failed pod stays around. With `OnFailure`, Kubernetes restarts the container inside the same pod. Different approaches to the same problem: retrying failed work.

**`backoffLimit`.** Jobs have a `backoffLimit` (default: 6) that controls how many times they'll retry before giving up. After 6 failures, the Job is marked as failed and stops creating pods.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: process-data
spec:
  backoffLimit: 3
  template:
    spec:
      containers:
        - name: worker
          image: busybox:1.33
          command: ['sh', '-c', 'exit 1']
      restartPolicy: Never
```

This Job will try 3 times (the initial run plus 2 retries), then mark itself as failed.

**`activeDeadlineSeconds`.** Sets a time limit for the Job. If it doesn't complete in time, all running pods are terminated and the Job is marked as failed. Useful for preventing stuck jobs from consuming resources forever.

**Parallel Jobs.** You can run multiple pods in parallel with `completions` and `parallelism`:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: parallel-work
spec:
  completions: 10
  parallelism: 3
  template:
    spec:
      containers:
        - name: worker
          image: busybox:1.33
          command: ['sh', '-c', 'echo "Working..." && sleep 5']
      restartPolicy: Never
```

This runs 10 pods total, up to 3 at a time. The Job is complete when 10 pods have exited successfully.

## CronJobs: scheduled Jobs

A CronJob is a wrapper around a Job that runs it on a schedule. The schedule uses standard cron syntax.

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: database-backup
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: busybox:1.33
              command:
                - 'sh'
                - '-c'
                - 'echo "Backing up database at $(date)" && sleep 30'
          restartPolicy: OnFailure
```

This creates a Job every day at 2:00 AM. The schedule field follows cron format: `minute hour day-of-month month day-of-week`. A few useful patterns:

- `*/5 * * * *` every 5 minutes
- `0 * * * *` every hour
- `0 0 * * 0` every Sunday at midnight
- `0 9 * * 1-5` weekdays at 9 AM

## Important CronJob fields

**`startingDeadlineSeconds`.** If a CronJob misses its scheduled time (maybe the controller was down), this field defines how late it can start before being skipped. If set to 100 (seconds), a job scheduled for 2:00 AM can still start if the controller comes back by 2:01:40 AM. After that, the run is skipped.

**`concurrencyPolicy`.** Controls what happens if a previous run is still active when the next one is due:

- `Allow` (default): run the new Job anyway, so both run in parallel
- `Forbid`: skip the new run if the previous one is still active
- `Replace`: cancel the running Job and start the new one

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: slow-task
spec:
  schedule: "*/5 * * * *"
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: slow
              image: busybox:1.33
              command: ['sh', '-c', 'echo "Starting..." && sleep 600']
          restartPolicy: Never
```

With `Forbid`, if the 5-minute task takes longer than 5 minutes, the next run is skipped instead of piling up.

**`successfulJobsHistoryLimit` and `failedJobsHistoryLimit`.** Control how many completed/failed Job objects are kept. Defaults are 3 and 1 respectively. Set `successfulJobsHistoryLimit: 0` if you don't want completed jobs cluttering your namespace.

**`suspend`.** New in Kubernetes 1.21 (beta). Pauses the CronJob. No new Jobs are created while suspended, but existing running Jobs continue.

## The gotcha with CronJob scheduling

CronJobs use the controller manager's timezone, which is usually UTC. If you need a different timezone, you'll need to adjust your cron expression (or set the `TZ` environment variable in Kubernetes 1.22+, where timezone support was added as alpha).

This has bitten me more than once. Someone sets a CronJob for "9 AM" and it runs at 9 AM UTC, which is 4 AM in their local time. Check what timezone your cluster is using.

## Cleaning up old Jobs

CronJobs create Job objects, and those Jobs create Pod objects. If you don't clean them up, your namespace fills with completed Jobs and their pods (the pods are usually gone, but the Job objects stick around based on your history limit settings).

Check with:

```bash
kubectl get jobs
kubectl get pods | grep Completed
```

The history limit fields help, but if you set them to non-zero values, remember that you're keeping Job objects (and their metadata) in etcd. For high-frequency CronJobs, this adds up.

## Updating from v1beta1 to v1

If you have existing CronJob manifests using `batch/v1beta1`:

```diff
- apiVersion: batch/v1beta1
+ apiVersion: batch/v1
  kind: CronJob
```

That's it. The spec is the same. The v1 API didn't change the schema, it just declared it stable. Update your manifests, run `kubectl apply`, and you're on the stable API.

If you're using Helm charts or operators that generate CronJobs, check if they've been updated to use `batch/v1`. Many haven't yet (as of mid-2021), and the v1beta1 API will be removed in a future release.

## When to use CronJobs vs external schedulers

CronJobs work well for:
- Periodic maintenance tasks (cleanup, backups)
- Report generation
- Data processing on a schedule

Consider an external scheduler (like Argo Workflows or Temporal) when:
- You need complex dependencies between tasks
- You need retries with backoff strategies beyond what Jobs offer
- You need visibility into workflow state and history
- Your "cron" is really a DAG of tasks

For simple periodic tasks, CronJobs are the right tool. Don't over-engineer it.



CronJobs reaching `batch/v1` is a quiet milestone. No new features, just stability. Update your apiVersion, keep your concurrency policies tight, and remember that CronJobs are just scheduled Jobs with all the Job behavior you'd expect (backoff limits, deadlines, parallelism). The fundamentals haven't changed, they're just officially stable now.