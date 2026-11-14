export type SessionImportDeeplinkStatus =
  | { state: 'idle' }
  | { state: 'importing' }
  | { state: 'completed'; sessionId: string; title: string; messageCount: number }
  | { state: 'failed'; message: string }
