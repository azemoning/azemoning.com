# azemoning.com

Personal portfolio and blog built with Astro, Tailwind CSS, and deployed to GitHub Pages.

## Tech Stack

- [Astro](https://astro.build) — Static site generator
- [Tailwind CSS](https://tailwindcss.com) — Utility-first CSS
- [TypeScript](https://www.typescriptlang.org/) — Type safety
- [Pagefind](https://pagefind.app/) — Static search
- [KaTeX](https://katex.org/) — Math rendering

## Features

- Portfolio with project showcase
- Blog with categories, search, and pagination
- Table of contents for blog posts
- Math expressions support
- GitHub-style callouts/alerts
- RSS feed and sitemap
- Responsive design

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build
```

## Deployment

The site is automatically deployed to GitHub Pages via GitHub Actions on every push to `main`.

Content is stored in a separate private repository and cloned during the build process.

## License

MIT
