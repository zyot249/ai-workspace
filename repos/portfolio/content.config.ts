import { defineCollection, defineContentConfig, z } from '@nuxt/content'

export default defineContentConfig({
  collections: {
    projects: defineCollection({
      type: 'page',
      source: 'projects/*.md',
      schema: z.object({
        title: z.string(),
        description: z.string(),
        stack: z.array(z.string()),
        repoUrl: z.string().optional(),
        demoUrl: z.string().optional(),
        cover: z.string().optional(),
        featured: z.boolean().default(false),
        date: z.string(),
      }),
    }),
    about: defineCollection({
      type: 'page',
      source: 'about.md',
      schema: z.object({}),
    }),
  },
})
