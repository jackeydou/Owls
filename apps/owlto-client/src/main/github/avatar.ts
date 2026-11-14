import { z } from 'zod'
import { PROFILE_AVATAR_IMAGE_LIMIT, PROFILE_AVATAR_SIZE } from '../../shared/profile.js'

const USER_URL = 'https://api.github.com/user'
const REQUEST_TIMEOUT_MS = 15_000
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/**
 * The signed-in user's GitHub avatar, as a data URL at the profile's size. The token goes
 * only to the API; the image is fetched from GitHub's avatar host without it.
 */
export async function fetchGitHubAvatar(
  token: string,
  http: typeof fetch = fetch
): Promise<{ login: string; src: string }> {
  const user = await http(USER_URL, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!user.ok) throw new Error(`GitHub returned ${user.status}.`)
  const { login, avatar_url } = z
    .object({ login: z.string(), avatar_url: z.string().url() })
    .parse(await user.json())
  const url = new URL(avatar_url)
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.githubusercontent.com'))
    throw new Error('Unexpected avatar host.')
  url.searchParams.set('s', String(PROFILE_AVATAR_SIZE))
  const image = await http(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!image.ok) throw new Error(`GitHub returned ${image.status}.`)
  const type = image.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
  if (!IMAGE_TYPES.has(type)) throw new Error('GitHub did not return an image.')
  const src = `data:${type};base64,${Buffer.from(await image.arrayBuffer()).toString('base64')}`
  if (src.length > PROFILE_AVATAR_IMAGE_LIMIT) throw new Error('The avatar is too large.')
  return { login, src }
}
