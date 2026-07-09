# azemoning.com Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal portfolio + blog site at azemoning.com using Astro 6, Tailwind CSS 4, and deploy to GitHub Pages with a custom domain.

**Architecture:** Astro static site with Tailwind CSS styling, Markdown blog posts via content collections, client-side search via Pagefind, deployed to GitHub Pages via GitHub Actions.

**Tech Stack:** Astro 6.x, Tailwind CSS 4.x (@tailwindcss/vite), TypeScript, Pagefind, @astrojs/rss, @astrojs/sitemap

## Global Constraints

- Node.js 18+ required
- All pages use Inter font (headings + body), JetBrains Mono for code
- Color palette: bg `#ffffff`, text `#1a1a2e`, accent `#2563eb`, muted `#6b7280`, code bg `#f8fafc`
- Blog posts max-width: 720px; project grid max-width: 1080px
- Draft posts (`draft: true`) hidden in production builds
- Custom domain: azemoning.com via CNAME file

---

### Task 1: Project Initialization

**Files:**
- Create: `package.json`
- Create: `astro.config.ts`
- Create: `tsconfig.json`
- Create: `src/styles/global.css`
- Create: `src/env.d.ts`

**Interfaces:**
- Produces: Astro project with Tailwind CSS 4 configured

- [ ] **Step 1: Initialize Astro project**

```bash
cd /home/upi/sandbox/azemoning.com
npm create astro@latest . -- --template minimal --no-install --no-git --typescript strict
```

- [ ] **Step 2: Install dependencies**

```bash
npm install astro @astrojs/rss @astrojs/sitemap tailwindcss @tailwindcss/vite
npm install -D typescript @types/node
```

- [ ] **Step 3: Configure Astro with Tailwind CSS**

```typescript
// astro.config.ts
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://azemoning.com',
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [sitemap()],
});
```

- [ ] **Step 4: Create global CSS**

```css
/* src/styles/global.css */
@import "tailwindcss";

@theme {
  --color-background: #ffffff;
  --color-text: #1a1a2e;
  --color-accent: #2563eb;
  --color-muted: #6b7280;
  --color-code-bg: #f8fafc;

  --font-heading: 'Inter', sans-serif;
  --font-body: 'Inter', sans-serif;
  --font-code: 'JetBrains Mono', monospace;
}
```

- [ ] **Step 5: Verify setup**

```bash
npm run dev
```

Expected: Astro dev server starts on http://localhost:4321

- [ ] **Step 6: Commit**

```bash
git init
git add .
git commit -m "chore: initialize astro project with tailwind css 4"
```

---

### Task 2: Layout Components

**Files:**
- Create: `src/layouts/BaseLayout.astro`
- Create: `src/components/Header.astro`
- Create: `src/components/Footer.astro`

**Interfaces:**
- Produces: `BaseLayout.astro` — wraps all pages with header, footer, global styles
- Produces: `Header.astro` — sticky nav with logo, Projects, Blog, About links
- Produces: `Footer.astro` — social links, copyright, RSS link

- [ ] **Step 1: Create Header component**

```astro
---
// src/components/Header.astro
const pathname = Astro.url.pathname;
---

<header class="sticky top-0 z-50 bg-background/80 backdrop-blur-sm border-b border-gray-100">
  <nav class="max-w-[1080px] mx-auto px-6 py-4 flex items-center justify-between">
    <a href="/" class="text-xl font-bold text-text hover:text-accent transition-colors">
      azemoning
    </a>
    <ul class="flex gap-8">
      <li>
        <a
          href="/projects"
          class:list={["text-sm font-medium transition-colors", pathname.startsWith("/projects") ? "text-accent" : "text-muted hover:text-text"]}
        >
          Projects
        </a>
      </li>
      <li>
        <a
          href="/blog"
          class:list={["text-sm font-medium transition-colors", pathname.startsWith("/blog") ? "text-accent" : "text-muted hover:text-text"]}
        >
          Blog
        </a>
      </li>
      <li>
        <a
          href="/about"
          class:list={["text-sm font-medium transition-colors", pathname === "/about" ? "text-accent" : "text-muted hover:text-text"]}
        >
          About
        </a>
      </li>
    </ul>
  </nav>
</header>
```

- [ ] **Step 2: Create Footer component**

```astro
---
// src/components/Footer.astro
const year = new Date().getFullYear();
---

<footer class="border-t border-gray-100 mt-auto">
  <div class="max-w-[1080px] mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
    <p class="text-sm text-muted">&copy; {year} azemoning. All rights reserved.</p>
    <div class="flex gap-6">
      <a href="https://github.com/azemoning" target="_blank" rel="noopener noreferrer" class="text-sm text-muted hover:text-accent transition-colors">
        GitHub
      </a>
      <a href="/rss.xml" class="text-sm text-muted hover:text-accent transition-colors">
        RSS
      </a>
    </div>
  </div>
</footer>
```

- [ ] **Step 3: Create BaseLayout**

```astro
---
// src/layouts/BaseLayout.astro
import Header from '../components/Header.astro';
import Footer from '../components/Footer.astro';
import '../styles/global.css';

interface Props {
  title: string;
  description?: string;
}

const { title, description = 'Personal portfolio and blog' } = Astro.props;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content={description} />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
    <title>{title} | azemoning</title>
  </head>
  <body class="min-h-screen flex flex-col bg-background text-text font-body">
    <Header />
    <main class="flex-1">
      <slot />
    </main>
    <Footer />
  </body>
</html>
```

- [ ] **Step 4: Verify layout renders**

```bash
npm run dev
```

Expected: Page shows header with nav links and footer with copyright

- [ ] **Step 5: Commit**

```bash
git add src/layouts src/components src/styles
git commit -m "feat: add base layout with header and footer"
```

---

### Task 3: Home Page

**Files:**
- Create: `src/pages/index.astro`
- Create: `src/data/projects.json`

**Interfaces:**
- Consumes: `BaseLayout.astro`
- Consumes: `projects.json` for featured projects section
- Produces: Home page with hero, featured projects, recent posts

- [ ] **Step 1: Create projects.json with sample data**

```json
[
  {
    "title": "SRE Observability Lab",
    "description": "Monitoring stack with Prometheus and Grafana for production environments.",
    "tags": ["Go", "Docker", "Kubernetes"],
    "github": "https://github.com/azemoning/sre-observability-lab",
    "featured": true
  },
  {
    "title": "Ansible Labs",
    "description": "Infrastructure automation exercises using Ansible playbooks.",
    "tags": ["Ansible", "Python", "Linux"],
    "github": "https://github.com/azemoning/ansible-labs",
    "featured": true
  },
  {
    "title": "CKA Prep",
    "description": "Kubernetes certification preparation notes and practice labs.",
    "tags": ["Kubernetes", "Docker", "YAML"],
    "github": "https://github.com/azemoning/cka",
    "featured": true
  }
]
```

- [ ] **Step 2: Create home page**

```astro
---
// src/pages/index.astro
import BaseLayout from '../layouts/BaseLayout.astro';
import projects from '../data/projects.json';

const featuredProjects = projects.filter(p => p.featured).slice(0, 3);
---

<BaseLayout title="Home">
  <section class="max-w-[720px] mx-auto px-6 py-20">
    <h1 class="text-4xl font-bold mb-4">Hi, I'm Azemoning</h1>
    <p class="text-lg text-muted mb-8">
      SRE / DevOps engineer passionate about infrastructure automation, observability, and cloud-native technologies.
    </p>
    <div class="flex gap-4">
      <a href="/projects" class="px-6 py-3 bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors">
        View Projects
      </a>
      <a href="/blog" class="px-6 py-3 border border-accent text-accent rounded-lg hover:bg-accent/10 transition-colors">
        Read Blog
      </a>
    </div>
  </section>

  <section class="max-w-[1080px] mx-auto px-6 py-16">
    <h2 class="text-2xl font-bold mb-8">Featured Projects</h2>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      {featuredProjects.map(project => (
        <div class="border border-gray-200 rounded-lg p-6 hover:border-accent/50 transition-colors">
          <h3 class="text-lg font-semibold mb-2">{project.title}</h3>
          <p class="text-sm text-muted mb-4">{project.description}</p>
          <div class="flex flex-wrap gap-2 mb-4">
            {project.tags.map(tag => (
              <span class="text-xs px-2 py-1 bg-gray-100 rounded">{tag}</span>
            ))}
          </div>
          <a href={project.github} target="_blank" rel="noopener noreferrer" class="text-sm text-accent hover:underline">
            GitHub →
          </a>
        </div>
      ))}
    </div>
  </section>
</BaseLayout>
```

- [ ] **Step 3: Verify home page renders**

```bash
npm run dev
```

Expected: Home page shows hero section and 3 featured project cards

- [ ] **Step 4: Commit**

```bash
git add src/pages/index.astro src/data/projects.json
git commit -m "feat: add home page with hero and featured projects"
```

---

### Task 4: About Page

**Files:**
- Create: `src/pages/about.astro`

**Interfaces:**
- Consumes: `BaseLayout.astro`

- [ ] **Step 1: Create about page**

```astro
---
// src/pages/about.astro
import BaseLayout from '../layouts/BaseLayout.astro';
---

<BaseLayout title="About" description="About Azemoning - SRE/DevOps Engineer">
  <article class="max-w-[720px] mx-auto px-6 py-16">
    <h1 class="text-3xl font-bold mb-8">About Me</h1>

    <div class="prose prose-lg">
      <p class="text-muted mb-6">
        I'm an SRE/DevOps engineer focused on infrastructure automation,
        observability, and cloud-native technologies. I enjoy building reliable
        systems and sharing knowledge through writing.
      </p>

      <h2 class="text-xl font-semibold mt-8 mb-4">Skills</h2>
      <div class="flex flex-wrap gap-2 mb-8">
        {['Kubernetes', 'Docker', 'Terraform', 'Ansible', 'Go', 'Python', 'Prometheus', 'Grafana', 'Linux', 'AWS'].map(skill => (
          <span class="text-sm px-3 py-1 border border-gray-200 rounded">{skill}</span>
        ))}
      </div>

      <h2 class="text-xl font-semibold mt-8 mb-4">Contact</h2>
      <ul class="space-y-2 text-muted">
        <li>
          <a href="https://github.com/azemoning" class="text-accent hover:underline">GitHub</a>
        </li>
        <li>
          <a href="mailto:hello@azemoning.com" class="text-accent hover:underline">hello@azemoning.com</a>
        </li>
      </ul>
    </div>
  </article>
</BaseLayout>
```

- [ ] **Step 2: Verify about page renders**

```bash
npm run dev
```

Expected: About page shows bio, skills tags, and contact links

- [ ] **Step 3: Commit**

```bash
git add src/pages/about.astro
git commit -m "feat: add about page with bio and skills"
```

---

### Task 5: Projects Page

**Files:**
- Create: `src/pages/projects.astro`

**Interfaces:**
- Consumes: `BaseLayout.astro`
- Consumes: `projects.json`

- [ ] **Step 1: Create projects page**

```astro
---
// src/pages/projects.astro
import BaseLayout from '../layouts/BaseLayout.astro';
import projects from '../data/projects.json';
---

<BaseLayout title="Projects" description="Portfolio of projects by Azemoning">
  <section class="max-w-[1080px] mx-auto px-6 py-16">
    <h1 class="text-3xl font-bold mb-8">Projects</h1>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {projects.map(project => (
        <div class="border border-gray-200 rounded-lg p-6 hover:border-accent/50 transition-colors">
          <h2 class="text-lg font-semibold mb-2">{project.title}</h2>
          <p class="text-sm text-muted mb-4">{project.description}</p>
          <div class="flex flex-wrap gap-2 mb-4">
            {project.tags.map(tag => (
              <span class="text-xs px-2 py-1 bg-gray-100 rounded">{tag}</span>
            ))}
          </div>
          <div class="flex gap-4">
            <a href={project.github} target="_blank" rel="noopener noreferrer" class="text-sm text-accent hover:underline">
              GitHub →
            </a>
            {project.live && (
              <a href={project.live} target="_blank" rel="noopener noreferrer" class="text-sm text-accent hover:underline">
                Live Demo →
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  </section>
</BaseLayout>
```

- [ ] **Step 2: Verify projects page renders**

```bash
npm run dev
```

Expected: Projects page shows all projects in a grid

- [ ] **Step 3: Commit**

```bash
git add src/pages/projects.astro
git commit -m "feat: add projects page with portfolio grid"
```

---

### Task 6: Blog Content Collection

**Files:**
- Create: `src/content.config.ts`
- Create: `src/content/blog/hello-world.md`
- Create: `src/content/blog/getting-started-with-kubernetes.md`

**Interfaces:**
- Produces: Blog content collection with frontmatter schema validation

- [ ] **Step 1: Define content collection schema**

```typescript
// src/content.config.ts
import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    slug: z.string().optional(),
    date: z.coerce.date(),
    lastUpdated: z.coerce.date().optional(),
    category: z.string(),
    tags: z.array(z.string()),
    readingTime: z.string(),
    excerpt: z.string(),
    draft: z.boolean().default(false),
    series: z.string().optional(),
    canonical: z.string().url().optional(),
  }),
});

export const collections = { blog };
```

- [ ] **Step 2: Create sample blog post**

```markdown
---
title: "Hello World"
date: 2026-07-10
category: "General"
tags: ["introduction", "blog"]
readingTime: "2 min read"
excerpt: "Welcome to my blog where I share thoughts on SRE, DevOps, and cloud-native technologies."
---

Welcome to my blog! I'm starting this space to share my experiences and learnings in the world of Site Reliability Engineering and DevOps.

## What to Expect

- Infrastructure automation tips
- Kubernetes and container orchestration
- Observability and monitoring best practices
- Cloud-native tooling reviews

Stay tuned for more content!
```

- [ ] **Step 3: Create second sample post**

```markdown
---
title: "Getting Started with Kubernetes"
date: 2026-07-08
category: "Kubernetes"
tags: ["kubernetes", "docker", "containers"]
readingTime: "5 min read"
excerpt: "A beginner's guide to understanding Kubernetes core concepts."
---

Kubernetes has become the de facto standard for container orchestration. In this post, we'll cover the fundamental concepts you need to get started.

## Core Concepts

### Pods
The smallest deployable unit in Kubernetes. A pod wraps one or more containers.

### Services
Services provide stable networking for pods. They load balance traffic across matching pods.

### Deployments
Deployments manage the desired state of your application, handling rolling updates and rollbacks.

## Your First Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
      - name: nginx
        image: nginx:1.25
        ports:
        - containerPort: 80
```

Apply it with:

```bash
kubectl apply -f deployment.yaml
```

## What's Next?

- Learn about ConfigMaps and Secrets
- Explore Ingress controllers
- Set up monitoring with Prometheus
```

- [ ] **Step 4: Verify content collection works**

```bash
npm run dev
```

Expected: No build errors, content collection registered

- [ ] **Step 5: Commit**

```bash
git add src/content.config.ts src/content/
git commit -m "feat: add blog content collection with sample posts"
```

---

### Task 7: Blog Index Page

**Files:**
- Create: `src/pages/blog/index.astro`

**Interfaces:**
- Consumes: `BaseLayout.astro`
- Consumes: Blog content collection
- Produces: Blog listing with category filters and pagination

- [ ] **Step 1: Create blog index page**

```astro
---
// src/pages/blog/index.astro
import BaseLayout from '../../layouts/BaseLayout.astro';
import { getCollection } from 'astro:content';

const allPosts = await getCollection('blog', ({ data }) => {
  return import.meta.env.PROD ? !data.draft : true;
});

const sortedPosts = allPosts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());

const categories = [...new Set(sortedPosts.map(post => post.data.category))];

const POSTS_PER_PAGE = 10;
const currentPage = 1;
const totalPages = Math.ceil(sortedPosts.length / POSTS_PER_PAGE);
const paginatedPosts = sortedPosts.slice(0, POSTS_PER_PAGE);
---

<BaseLayout title="Blog" description="Articles on SRE, DevOps, and cloud-native technologies">
  <section class="max-w-[720px] mx-auto px-6 py-16">
    <h1 class="text-3xl font-bold mb-8">Blog</h1>

    <div class="flex flex-wrap gap-2 mb-8">
      <button class="category-btn text-sm px-3 py-1 border border-accent text-accent rounded active" data-category="all">
        All
      </button>
      {categories.map(category => (
        <button class="category-btn text-sm px-3 py-1 border border-gray-200 rounded hover:border-accent hover:text-accent transition-colors" data-category={category}>
          {category}
        </button>
      ))}
    </div>

    <div id="posts-list" class="space-y-8">
      {paginatedPosts.map(post => (
        <article class="post-item" data-category={post.data.category}>
          <a href={`/blog/${post.data.slug ?? post.id}/`} class="group block">
            <div class="flex items-center gap-4 text-sm text-muted mb-2">
              <time datetime={post.data.date.toISOString()}>
                {post.data.date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </time>
              <span>{post.data.category}</span>
              <span>{post.data.readingTime}</span>
            </div>
            <h2 class="text-lg font-semibold group-hover:text-accent transition-colors mb-2">
              {post.data.title}
            </h2>
            <p class="text-muted text-sm">{post.data.excerpt}</p>
          </a>
        </article>
      ))}
    </div>

    {totalPages > 1 && (
      <nav class="flex justify-center gap-4 mt-12">
        <a href="/blog/2" class="px-4 py-2 border border-gray-200 rounded hover:border-accent hover:text-accent transition-colors">
          Next →
        </a>
      </nav>
    )}
  </section>
</BaseLayout>

<script>
  document.querySelectorAll('.category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const category = btn.dataset.category;

      document.querySelectorAll('.category-btn').forEach(b => {
        b.classList.remove('border-accent', 'text-accent', 'active');
        b.classList.add('border-gray-200');
      });
      btn.classList.add('border-accent', 'text-accent', 'active');
      btn.classList.remove('border-gray-200');

      document.querySelectorAll('.post-item').forEach(item => {
        if (category === 'all' || item.dataset.category === category) {
          item.style.display = 'block';
        } else {
          item.style.display = 'none';
        }
      });
    });
  });
</script>
```

- [ ] **Step 2: Verify blog index renders**

```bash
npm run dev
```

Navigate to http://localhost:4321/blog

Expected: Blog index shows posts with category filter buttons

- [ ] **Step 3: Commit**

```bash
git add src/pages/blog/
git commit -m "feat: add blog index page with category filters"
```

---

### Task 8: Blog Post Page with TOC

**Files:**
- Create: `src/pages/blog/[slug].astro`

**Interfaces:**
- Consumes: `BaseLayout.astro`
- Consumes: Blog content collection
- Produces: Individual post page with TOC sidebar

- [ ] **Step 1: Create blog post page**

```astro
---
// src/pages/blog/[slug].astro
import BaseLayout from '../../layouts/BaseLayout.astro';
import { getCollection, render } from 'astro:content';

export async function getStaticPaths() {
  const posts = await getCollection('blog', ({ data }) => {
    return import.meta.env.PROD ? !data.draft : true;
  });

  return posts.map(post => ({
    params: { slug: post.data.slug ?? post.id },
    props: { post },
  }));
}

const { post } = Astro.props;
const { Content, headings } = await render(post);

const allPosts = await getCollection('blog', ({ data }) => {
  return import.meta.env.PROD ? !data.draft : true;
});

const relatedPosts = allPosts
  .filter(p => p.data.category === post.data.category && p.id !== post.id)
  .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
  .slice(0, 3);

const toc = headings.filter(h => h.depth === 2 || h.depth === 3);
---

<BaseLayout title={post.data.title} description={post.data.excerpt}>
  <article class="max-w-[1080px] mx-auto px-6 py-16">
    <div class="flex gap-12">
      <aside class="hidden lg:block w-64 shrink-0">
        <div class="sticky top-24">
          <h3 class="text-sm font-semibold text-muted uppercase tracking-wider mb-4">Table of Contents</h3>
          <nav class="space-y-2">
            {toc.map(heading => (
              <a
                href={`#${heading.slug}`}
                class:list={[
                  "block text-sm text-muted hover:text-accent transition-colors",
                  heading.depth === 3 && "pl-4"
                ]}
              >
                {heading.text}
              </a>
            ))}
          </nav>
        </div>
      </aside>

      <div class="max-w-[720px] flex-1">
        <header class="mb-8 border-b border-gray-100 pb-8">
          <div class="flex items-center gap-4 text-sm text-muted mb-4">
            <time datetime={post.data.date.toISOString()}>
              {post.data.date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </time>
            <span>{post.data.category}</span>
            <span>{post.data.readingTime}</span>
          </div>
          <h1 class="text-3xl font-bold mb-4">{post.data.title}</h1>
          {post.data.lastUpdated && (
            <p class="text-sm text-muted">
              Last updated: {post.data.lastUpdated.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          )}
          <div class="flex flex-wrap gap-2 mt-4">
            {post.data.tags.map(tag => (
              <span class="text-xs px-2 py-1 bg-gray-100 rounded">{tag}</span>
            ))}
          </div>
        </header>

        <div class="prose prose-lg max-w-none">
          <Content />
        </div>

        {relatedPosts.length > 0 && (
          <section class="mt-16 pt-8 border-t border-gray-100">
            <h2 class="text-xl font-semibold mb-6">Related Posts</h2>
            <div class="space-y-4">
              {relatedPosts.map(related => (
                <a href={`/blog/${related.data.slug ?? related.id}/`} class="block group">
                  <h3 class="text-lg font-medium group-hover:text-accent transition-colors">
                    {related.data.title}
                  </h3>
                  <p class="text-sm text-muted">{related.data.excerpt}</p>
                </a>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  </article>
</BaseLayout>
```

- [ ] **Step 2: Verify blog post renders**

```bash
npm run dev
```

Navigate to http://localhost:4321/blog/hello-world/

Expected: Blog post shows with TOC sidebar, tags, related posts

- [ ] **Step 3: Commit**

```bash
git add src/pages/blog/\[slug\].astro
git commit -m "feat: add blog post page with TOC and related posts"
```

---

### Task 9: Pagination

**Files:**
- Create: `src/pages/blog/[page].astro`

**Interfaces:**
- Consumes: Blog content collection
- Produces: Paginated blog listing

- [ ] **Step 1: Create paginated blog page**

```astro
---
// src/pages/blog/[page].astro
import BaseLayout from '../../layouts/BaseLayout.astro';
import { getCollection } from 'astro:content';

export async function getStaticPaths({ paginate }) {
  const allPosts = await getCollection('blog', ({ data }) => {
    return import.meta.env.PROD ? !data.draft : true;
  });

  const sortedPosts = allPosts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());

  return paginate(sortedPosts, { pageSize: 10 });
}

const { page } = Astro.props;
const categories = [...new Set(page.data.map(post => post.data.category))];
---

<BaseLayout title={`Blog - Page ${page.currentPage}`} description="Articles on SRE, DevOps, and cloud-native technologies">
  <section class="max-w-[720px] mx-auto px-6 py-16">
    <h1 class="text-3xl font-bold mb-8">Blog</h1>

    <div class="flex flex-wrap gap-2 mb-8">
      <a href="/blog" class="text-sm px-3 py-1 border border-gray-200 rounded hover:border-accent hover:text-accent transition-colors">
        All
      </a>
      {categories.map(category => (
        <a href={`/blog/category/${category.toLowerCase()}`} class="text-sm px-3 py-1 border border-gray-200 rounded hover:border-accent hover:text-accent transition-colors">
          {category}
        </a>
      ))}
    </div>

    <div class="space-y-8">
      {page.data.map(post => (
        <article>
          <a href={`/blog/${post.data.slug ?? post.id}/`} class="group block">
            <div class="flex items-center gap-4 text-sm text-muted mb-2">
              <time datetime={post.data.date.toISOString()}>
                {post.data.date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </time>
              <span>{post.data.category}</span>
              <span>{post.data.readingTime}</span>
            </div>
            <h2 class="text-lg font-semibold group-hover:text-accent transition-colors mb-2">
              {post.data.title}
            </h2>
            <p class="text-muted text-sm">{post.data.excerpt}</p>
          </a>
        </article>
      ))}
    </div>

    <nav class="flex justify-between items-center mt-12">
      {page.url.prev ? (
        <a href={page.url.prev} class="px-4 py-2 border border-gray-200 rounded hover:border-accent hover:text-accent transition-colors">
          ← Previous
        </a>
      ) : <div />}
      <span class="text-sm text-muted">
        Page {page.currentPage} of {page.lastPage}
      </span>
      {page.url.next ? (
        <a href={page.url.next} class="px-4 py-2 border border-gray-200 rounded hover:border-accent hover:text-accent transition-colors">
          Next →
        </a>
      ) : <div />}
    </nav>
  </section>
</BaseLayout>
```

- [ ] **Step 2: Update blog index to redirect to page 1**

Update `src/pages/blog/index.astro` to redirect to `/blog/1` or keep it as page 1.

- [ ] **Step 3: Verify pagination works**

```bash
npm run dev
```

Expected: Blog pages show pagination controls when > 10 posts

- [ ] **Step 4: Commit**

```bash
git add src/pages/blog/
git commit -m "feat: add blog pagination"
```

---

### Task 10: Pagefind Search Integration

**Files:**
- Modify: `package.json`
- Create: `src/components/Search.astro`

**Interfaces:**
- Produces: `Search.astro` — client-side search component using Pagefind

- [ ] **Step 1: Add Pagefind build script**

```json
// package.json - add to scripts
{
  "scripts": {
    "build": "astro build && npx pagefind --site dist"
  }
}
```

- [ ] **Step 2: Create Search component**

```astro
---
// src/components/Search.astro
---

<div id="search" class="relative">
  <input
    type="text"
    id="search-input"
    placeholder="Search posts..."
    class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-accent"
  />
  <div id="search-results" class="absolute z-10 w-full mt-2 bg-white border border-gray-200 rounded-lg shadow-lg hidden max-h-96 overflow-y-auto">
  </div>
</div>

<script is:inline>
  document.addEventListener('DOMContentLoaded', async () => {
    const pagefind = await import('/pagefind/pagefind.js');
    await pagefind.init();

    const input = document.getElementById('search-input');
    const results = document.getElementById('search-results');

    input.addEventListener('input', async (e) => {
      const query = e.target.value.trim();

      if (query.length < 2) {
        results.classList.add('hidden');
        results.innerHTML = '';
        return;
      }

      const search = await pagefind.search(query);
      const resultsData = await Promise.all(search.results.slice(0, 5).map(r => r.data()));

      if (resultsData.length === 0) {
        results.innerHTML = '<div class="p-4 text-sm text-muted">No results found</div>';
        results.classList.remove('hidden');
        return;
      }

      results.innerHTML = resultsData.map(r => `
        <a href="${r.url}" class="block p-4 hover:bg-gray-50 border-b border-gray-100 last:border-0">
          <h4 class="text-sm font-semibold">${r.meta.title}</h4>
          <p class="text-xs text-muted mt-1">${r.excerpt}</p>
        </a>
      `).join('');

      results.classList.remove('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#search')) {
        results.classList.add('hidden');
      }
    });
  });
</script>
```

- [ ] **Step 3: Add Search to blog index**

Import and add `<Search />` component to blog index page.

- [ ] **Step 4: Verify search works**

```bash
npm run build
npm run preview
```

Expected: Search input appears, typing shows results from blog posts

- [ ] **Step 5: Commit**

```bash
git add src/components/Search.astro package.json
git commit -m "feat: add Pagefind search integration"
```

---

### Task 11: RSS Feed

**Files:**
- Create: `src/pages/rss.xml.ts`

**Interfaces:**
- Consumes: Blog content collection
- Produces: RSS feed at `/rss.xml`

- [ ] **Step 1: Create RSS feed endpoint**

```typescript
// src/pages/rss.xml.ts
import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = await getCollection('blog', ({ data }) => {
    return import.meta.env.PROD ? !data.draft : true;
  });

  const sortedPosts = posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());

  return rss({
    title: 'azemoning',
    description: 'Articles on SRE, DevOps, and cloud-native technologies',
    site: context.site!,
    items: sortedPosts.map(post => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.excerpt,
      link: `/blog/${post.data.slug ?? post.id}/`,
    })),
    customData: '<language>en-us</language>',
  });
}
```

- [ ] **Step 2: Verify RSS feed generates**

```bash
npm run build
cat dist/rss.xml
```

Expected: Valid XML RSS feed with blog posts

- [ ] **Step 3: Commit**

```bash
git add src/pages/rss.xml.ts
git commit -m "feat: add RSS feed"
```

---

### Task 12: GitHub Pages Deployment

**Files:**
- Create: `.github/workflows/deploy.yml`
- Create: `public/CNAME`
- Create: `public/robots.txt`

**Interfaces:**
- Produces: GitHub Actions workflow for auto-deploy
- Produces: CNAME file for custom domain

- [ ] **Step 1: Create CNAME file**

```
azemoning.com
```

- [ ] **Step 2: Create robots.txt**

```
User-agent: *
Allow: /

Sitemap: https://azemoning.com/sitemap-index.xml
```

- [ ] **Step 3: Create GitHub Actions workflow**

```yaml
# .github/workflows/deploy.yml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build with Astro
        run: npm run build

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 4: Verify build works locally**

```bash
npm run build
ls dist/
```

Expected: dist/ contains index.html, blog/, projects/, rss.xml, sitemap.xml

- [ ] **Step 5: Commit**

```bash
git add .github/ public/CNAME public/robots.txt
git commit -m "feat: add GitHub Pages deployment workflow"
```

---

### Task 13: Final Polish

**Files:**
- Create: `public/favicon.svg`

**Interfaces:**
- Produces: Complete, production-ready site

- [ ] **Step 1: Create favicon**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <text y="80" font-size="80" font-family="Inter, sans-serif" font-weight="bold" fill="#2563eb">A</text>
</svg>
```

- [ ] **Step 2: Final build test**

```bash
npm run build
npm run preview
```

Expected: All pages render correctly, no build errors

- [ ] **Step 3: Commit**

```bash
git add public/favicon.svg
git commit -m "feat: add favicon"
```

---

## Deployment Checklist

1. Create GitHub repository `azemoning.com`
2. Push code to `main` branch
3. Go to Settings > Pages > Source: GitHub Actions
4. Add DNS records for custom domain:
   - Type: A, Host: @, Points to: 185.199.108.153
   - Type: A, Host: @, Points to: 185.199.109.153
   - Type: A, Host: @, Points to: 185.199.110.153
   - Type: A, Host: @, Points to: 185.199.111.153
   - Type: CNAME, Host: www, Points to: azemoning.github.io
5. In GitHub Settings > Pages > Custom domain: enter `azemoning.com`
6. Enable "Enforce HTTPS"
7. Wait for DNS propagation (up to 48 hours)
