import { z } from 'zod'
import { memoryStoreSchema, projectMemoryKindSchema } from '../../shared/memory.js'

/** search_memory's arguments (RFC_OWLS_MEMORY 6.2). */
export const searchMemoryInput = z
  .object({
    store: memoryStoreSchema.optional().describe('Search one store; omit to search both.'),
    category: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .optional()
      .describe('A personal category, by name or ID.'),
    project: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe('Project memories of this project, by name or ID.'),
    kind: projectMemoryKindSchema.optional().describe('Project memories of this kind.'),
    query: z.string().trim().max(200).optional().describe('Keywords, separated by spaces.'),
    limit: z.number().int().min(1).max(20).optional().describe('At most this many; default 10.')
  })
  .strict()
export type SearchMemoryInput = z.infer<typeof searchMemoryInput>
