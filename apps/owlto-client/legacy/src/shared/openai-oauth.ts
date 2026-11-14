export const OPENAI_OAUTH_PROVIDER_ID = 'openai-codex' as const

export type OpenAIOAuthModel = {
  id: string
  name: string
  kind: 'chat' | 'image'
  enabled: boolean
}

export type OpenAIOAuthStatus = {
  signedIn: boolean
  models: OpenAIOAuthModel[]
}
