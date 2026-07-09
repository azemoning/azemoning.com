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
