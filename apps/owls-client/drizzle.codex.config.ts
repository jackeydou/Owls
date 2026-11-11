import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/main/app/schema.ts',
  out: './drizzle-codex',
  dialect: 'sqlite'
})
