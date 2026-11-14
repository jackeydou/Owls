import { z } from 'zod'

/** Side of the square an avatar image is kept at: sharp at 2x in the largest 64px preview. */
export const PROFILE_AVATAR_SIZE = 128
/** Longest avatar image kept, as a data URL; uploads are scaled down to fit. */
export const PROFILE_AVATAR_IMAGE_LIMIT = 256 * 1024
export const PROFILE_NAME_LIMIT = 40

const avatarImageSchema = z
  .string()
  .max(PROFILE_AVATAR_IMAGE_LIMIT)
  .regex(/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/, 'Invalid image')
const owlAvatarSchema = z.object({ kind: z.literal('owl') })
const uploadAvatarSchema = z.object({ kind: z.literal('upload'), src: avatarImageSchema })
/**
 * The user's picture: the default user owl, an image they uploaded, or their GitHub
 * avatar. Images are raster data URLs, never a path or a remote URL, so they work offline.
 */
export const profileAvatarSchema = z.discriminatedUnion('kind', [
  owlAvatarSchema,
  uploadAvatarSchema,
  z.object({ kind: z.literal('github'), login: z.string(), src: avatarImageSchema })
])
export const profileSchema = z.object({
  /** Null shows the default label ("You"). */
  name: z.string().max(PROFILE_NAME_LIMIT).nullable(),
  avatar: profileAvatarSchema,
  /**
   * The user changed the avatar themselves. Until then a GitHub connection replaces the
   * default owl with the GitHub avatar; after that it is left alone.
   */
  avatarChanged: z.boolean()
})
export type Profile = z.infer<typeof profileSchema>
export type ProfileAvatar = z.infer<typeof profileAvatarSchema>
export const defaultProfile: Profile = {
  name: null,
  avatar: { kind: 'owl' },
  avatarChanged: false
}

/** A change the settings page saves: a new name, or the owl or an uploaded image. */
export const profileUpdateSchema = z
  .object({
    /** Blank goes back to the default label. */
    name: z
      .string()
      .trim()
      .max(PROFILE_NAME_LIMIT)
      .transform((name) => name || null)
      .optional(),
    avatar: z.discriminatedUnion('kind', [owlAvatarSchema, uploadAvatarSchema]).optional()
  })
  .strict()
export type ProfileUpdate = z.input<typeof profileUpdateSchema>
