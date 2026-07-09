# azemoning.com — Portfolio + Blog Design

**Date:** 2026-07-10
**Domain:** azemoning.com
**Purpose:** Personal portfolio + blog with enhanced blog features

---

## 1. Site Structure

**Pages:**
- `/` — Home (hero + featured projects + recent posts)
- `/about` — Bio, skills, contact info
- `/projects` — Portfolio grid
- `/blog` — Blog index with search + category filters
- `/blog/[slug]` — Individual post with TOC

**Navigation:**
- Sticky top nav: Logo/name | Projects | Blog | About
- Footer: social links, copyright, RSS link

---

## 2. Portfolio Section

**Layout:** Grid of project cards (3 columns desktop, 1 mobile)

**Each card:**
- Project title
- Short description (1-2 sentences)
- Tech stack tags
- Links: GitHub repo | Live demo (if any)

**Data stored in:** `src/data/projects.json`

---

## 3. Blog Section

**Blog index:**
- Client-side search bar (Pagefind)
- Category filter buttons
- Post list: title | date | category | reading time
- Pagination (10 posts per page)

**Individual post:**
- Title, date, reading time
- Category + tags
- Table of contents (sticky sidebar on desktop)
- Syntax-highlighted code blocks
- Related posts (same category)
- RSS feed auto-generated

**Frontmatter schema:**
```yaml
---
title: "Post Title"
slug: "custom-url-slug"          # optional, overrides auto-generated
date: 2025-01-15
lastUpdated: 2025-03-20          # revision tracking
category: "SRE"
tags: ["prometheus", "monitoring"]
readingTime: "5 min read"
excerpt: "Short summary for cards + SEO meta description."
draft: true                      # hidden in production
series: "Monitoring Fundamentals" # multi-part posts
canonical: "https://dev.to/..."  # cross-post SEO
---
```

**Content location:** `src/content/blog/`

---

## 4. Styling & Design

**Color palette:**
- Background: `#ffffff` (white)
- Text: `#1a1a2e` (near-black)
- Accent: `#2563eb` (blue)
- Muted: `#6b7280` (gray)
- Code blocks: `#f8fafc` (light gray)

**Typography:**
- Headings: Inter
- Body: Inter
- Code: JetBrains Mono

**Layout:**
- Blog posts: max-width `720px`
- Project grid: max-width `1080px`
- Generous whitespace, minimal borders
- Subtle hover effects

---

## 5. Tech Stack

- **Astro 6.x** — static site generator
- **Tailwind CSS 4.x** — styling (via `@tailwindcss/vite` plugin)
- **TypeScript** — type safety
- **Markdown/MDX** — content
- **Pagefind** — client-side search
- **@astrojs/rss** — RSS feed
- **@astrojs/sitemap** — sitemap.xml

---

## 6. Project Structure

```
azemoning.com/
├── src/
│   ├── components/    # UI components
│   ├── content/
│   │   └── blog/      # Markdown blog posts
│   ├── data/
│   │   └── projects.json
│   ├── layouts/       # Page layouts
│   ├── pages/         # Routes
│   └── styles/        # Global styles
├── public/            # Static assets
├── astro.config.ts
└── tailwind.config.ts
```

---

## 7. Deployment

- **Hosting:** GitHub Pages via GitHub Actions
- **Workflow:** Push to `main` → build → deploy
- **Custom domain:** `azemoning.com` via `CNAME` file
- **HTTPS:** GitHub's automatic SSL
