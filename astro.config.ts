import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkGithubBlockquoteAlert from 'remark-github-blockquote-alert';
import remarkDefinitionList from 'remark-definition-list';
import remarkAbbr from 'remark-abbr';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function getDraftUrls(): Set<string> {
  const blogDir = join(process.cwd(), 'src/content/blog');
  const files = readdirSync(blogDir);
  const draftUrls = new Set<string>();

  for (const file of files) {
    if (!file.endsWith('.md') && !file.endsWith('.mdx')) continue;
    const content = readFileSync(join(blogDir, file), 'utf-8');
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatter) continue;

    const draftMatch = frontmatter[1].match(/^draft:\s*(true)/m);
    const slugMatch = frontmatter[1].match(/^slug:\s*["'](.+?)["']/m);
    const slug = slugMatch ? slugMatch[1] : file.replace(/\.mdx?$/, '');

    if (draftMatch) {
      draftUrls.add(`/blog/${slug}/`);
    }
  }

  return draftUrls;
}

const draftUrls = getDraftUrls();

export default defineConfig({
  site: 'https://azemoning.com',
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    sitemap({
      filter: (page) => !draftUrls.has(new URL(page).pathname),
    }),
  ],
  markdown: {
    remarkPlugins: [
      remarkGfm,
      remarkMath,
      remarkGithubBlockquoteAlert,
      remarkDefinitionList,
      remarkAbbr,
    ],
    rehypePlugins: [
      rehypeKatex,
    ],
  },
});
