import { createRequire } from 'node:module'

export const OWLS_FILE_DESCRIPTOR_LIMIT = 1_048_575

const require = createRequire(import.meta.url)

type MacProcessLimitsBinding = {
  raiseFileDescriptorLimit: (targetSoft?: number | null) => unknown
}

export function raiseOwlsFileDescriptorLimit(): void {
  if (process.platform !== 'darwin') return

  try {
    const { raiseFileDescriptorLimit } =
      require('@owls/mac-process-limits') as MacProcessLimitsBinding
    raiseFileDescriptorLimit(OWLS_FILE_DESCRIPTOR_LIMIT)
  } catch (error) {
    console.warn(
      'Failed to raise file descriptor limit:',
      error instanceof Error ? error.message : String(error)
    )
  }
}

raiseOwlsFileDescriptorLimit()
