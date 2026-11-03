import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './legacy/src/main/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: pathToFileURL(join(homedir(), '.pichu', 'pichu.db')).href
  }
})
