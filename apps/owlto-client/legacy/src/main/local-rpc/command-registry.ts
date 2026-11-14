import { JSON_RPC_INVALID_PARAMS, LOCAL_RPC_METHOD_DISABLED, LocalRpcError } from './errors.js'

export type LocalRpcParamParser<TParams> = (value: unknown) => TParams

export type LocalRpcCommand<TContext, TParams, TResult> = {
  method: string
  description: string
  enabled?: (context: TContext) => boolean
  parseParams: LocalRpcParamParser<TParams>
  run: (params: TParams, context: TContext) => Promise<TResult> | TResult
}

export class LocalRpcCommandRegistry<TContext> {
  private readonly commands = new Map<string, LocalRpcCommand<TContext, unknown, unknown>>()

  register<TParams, TResult>(command: LocalRpcCommand<TContext, TParams, TResult>): void {
    if (this.commands.has(command.method)) {
      throw new Error(`Local RPC command is already registered: ${command.method}`)
    }
    this.commands.set(command.method, command as LocalRpcCommand<TContext, unknown, unknown>)
  }

  methods(): string[] {
    return [...this.commands.keys()].sort((left, right) => left.localeCompare(right))
  }

  has(method: string): boolean {
    return this.commands.has(method)
  }

  async run(method: string, params: unknown, context: TContext): Promise<unknown> {
    const command = this.commands.get(method)
    if (!command) return undefined
    if (command.enabled && !command.enabled(context)) {
      throw new LocalRpcError(LOCAL_RPC_METHOD_DISABLED, `Method disabled: ${method}`)
    }

    let parsedParams: unknown
    try {
      parsedParams = command.parseParams(params)
    } catch (error) {
      if (error instanceof LocalRpcError) throw error
      throw new LocalRpcError(
        JSON_RPC_INVALID_PARAMS,
        error instanceof Error ? error.message : 'Invalid params'
      )
    }
    return command.run(parsedParams, context)
  }
}
