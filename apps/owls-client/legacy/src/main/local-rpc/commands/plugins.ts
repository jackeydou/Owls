import type { PluginAdminUploadResult } from '../../../shared/plugin-admin.js'
import type { InstalledPlugin, PluginMarketplaceEntry } from '../../plugins/plugin-types.js'
import type { LocalRpcCommandRegistry } from '../command-registry.js'
import {
  JSON_RPC_INVALID_PARAMS,
  LOCAL_RPC_CONFLICT,
  LOCAL_RPC_TIMEOUT,
  LocalRpcError
} from '../errors.js'
import { requireAuthenticatedLocalRpc } from '../guards.js'
import {
  type EmptyParams,
  type PluginUploadParams,
  parseEmptyParams,
  parsePluginInstallLocalParams,
  parsePluginInstallParams,
  parsePluginUninstallParams,
  parsePluginUploadParams
} from '../schemas.js'
import type { LocalRpcContext } from '../types.js'

function isPluginPackageParamError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.startsWith('plugin manifest name ') ||
    normalized.startsWith('plugin zip ') ||
    normalized.startsWith('zip ') ||
    normalized.startsWith('plugin package ') ||
    normalized.includes('root plugin.json') ||
    normalized.includes('component path') ||
    normalized.includes('manifest')
  )
}

function rethrowLocalRpcPluginError(error: unknown): never {
  if (error instanceof LocalRpcError) throw error
  if (error instanceof Error) {
    const message = error.message
    if (message.includes('timed out')) {
      throw new LocalRpcError(LOCAL_RPC_TIMEOUT, message)
    }
    if (message.includes('already exists')) {
      throw new LocalRpcError(LOCAL_RPC_CONFLICT, message)
    }
    if (isPluginPackageParamError(message)) {
      throw new LocalRpcError(JSON_RPC_INVALID_PARAMS, message)
    }
  }
  throw error
}

async function runPluginLocalRpcCommand<TResult>(
  operation: () => Promise<TResult>
): Promise<TResult> {
  try {
    return await operation()
  } catch (error) {
    rethrowLocalRpcPluginError(error)
  }
}

export function registerPluginLocalRpcCommands(
  registry: LocalRpcCommandRegistry<LocalRpcContext>
): void {
  registry.register<
    EmptyParams,
    { available: PluginMarketplaceEntry[]; installed: InstalledPlugin[] }
  >({
    method: 'plugin.list',
    description: 'List available marketplace plugins and installed plugins.',
    parseParams: parseEmptyParams,
    run: async (_, context) => {
      requireAuthenticatedLocalRpc(context)
      return context.listPlugins()
    }
  })

  registry.register<{ marketplaceName: string; pluginName: string }, InstalledPlugin>({
    method: 'plugin.install',
    description: 'Install a plugin from a marketplace entry.',
    parseParams: parsePluginInstallParams,
    run: async (params, context) => {
      requireAuthenticatedLocalRpc(context)
      return context.installPlugin(params)
    }
  })

  registry.register<{ sourcePath: string }, InstalledPlugin>({
    method: 'plugin.installLocal',
    description: 'Install a plugin from a local plugin package directory (developer upload).',
    parseParams: parsePluginInstallLocalParams,
    run: async (params, context) => {
      requireAuthenticatedLocalRpc(context)
      return context.installLocalPlugin(params)
    }
  })

  registry.register<{ pluginName: string }, { uninstalled: boolean }>({
    method: 'plugin.uninstall',
    description: 'Uninstall an installed plugin by name.',
    parseParams: parsePluginUninstallParams,
    run: async (params, context) => {
      requireAuthenticatedLocalRpc(context)
      return context.uninstallPlugin(params.pluginName)
    }
  })

  registry.register<PluginUploadParams, PluginAdminUploadResult>({
    method: 'plugin.upload',
    description: 'Validate and install a plugin zip as a local developer build.',
    parseParams: parsePluginUploadParams,
    run: async (params, context) => {
      requireAuthenticatedLocalRpc(context)
      return runPluginLocalRpcCommand(() => context.uploadPlugin(params))
    }
  })
}
