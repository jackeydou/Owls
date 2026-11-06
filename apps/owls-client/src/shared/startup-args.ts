export const DATA_ROOT_ARG_NAMES = ['--owls-data-root', '--data-root', '--pix-data-root'] as const
export const DEV_NAME_ARG_NAMES = ['--owls-dev-name', '--dev-name', '--pix-dev-name'] as const

type StartupArgName = (typeof DATA_ROOT_ARG_NAMES)[number] | (typeof DEV_NAME_ARG_NAMES)[number]

export type StartupArg<TName extends StartupArgName = StartupArgName> = {
  name: TName
  value: string
}

function parseStringArg<TName extends StartupArgName>(
  argv: readonly string[],
  names: readonly TName[]
): StartupArg<TName> | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    for (const name of names) {
      if (arg === name) {
        const value = argv[index + 1]?.trim()
        if (!value || value.startsWith('--')) return null
        return { name, value }
      }

      const prefix = `${name}=`
      if (arg.startsWith(prefix)) {
        const value = arg.slice(prefix.length).trim()
        if (!value) return null
        return { name, value }
      }
    }
  }

  return null
}

export function parseDataRootArg(
  argv: readonly string[]
): StartupArg<(typeof DATA_ROOT_ARG_NAMES)[number]> | null {
  return parseStringArg(argv, DATA_ROOT_ARG_NAMES)
}

export function parseDevNameArg(
  argv: readonly string[]
): StartupArg<(typeof DEV_NAME_ARG_NAMES)[number]> | null {
  return parseStringArg(argv, DEV_NAME_ARG_NAMES)
}
