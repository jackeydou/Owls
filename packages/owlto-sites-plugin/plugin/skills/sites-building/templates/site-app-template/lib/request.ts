export class HttpError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.body = body
  }
}

export async function fetchJson<TData>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<TData> {
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  const response = await fetch(input, {
    ...init,
    headers
  })
  const body = await readJsonBody(response)

  if (!response.ok) {
    throw new HttpError(readErrorMessage(body, response.statusText), response.status, body)
  }

  return body as TData
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function readErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
    return body.message
  }

  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
    return body.error
  }

  return fallback || 'Request failed'
}
