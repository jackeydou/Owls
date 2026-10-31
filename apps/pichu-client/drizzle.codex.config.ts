import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/main/codex/schema.ts',
  out: './drizzle-codex',
  dialect: 'sqlite'
})
