export type BuildMode = 'debug' | 'release'

declare const __PICHU_BUILD_MODE__: BuildMode

export const buildMode: BuildMode = __PICHU_BUILD_MODE__
export const isDebugPackage = buildMode === 'debug'
export const isReleasePackage = buildMode === 'release'
