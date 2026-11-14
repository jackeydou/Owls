import { z } from 'zod'
import { deviceIdSchema, effortSchema, permissionSchema, providerSchema } from './app.js'
import { worktreeBaseSchema } from './router.js'

/**
 * What one device asks another to do with a worker (RFC_OWLTO_MULTI_DEVICE 6.1).
 * Commands are ordinary sync records written by the sender; only the receiver
 * runs them. `commandId` is the idempotency key, and for a dispatch it is also
 * the new worker's id.
 */
const commandBase = {
  commandId: z.string().min(1).max(64),
  from: deviceIdSchema,
  to: deviceIdSchema,
  createdAt: z.string(),
  /** Only a dispatch expires. */
  expiresAt: z.string().nullable()
}
const workerId = z.string().min(1).max(64)
export const deviceCommandSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...commandBase,
      kind: z.literal('dispatch'),
      workerId,
      routerId: z.string().min(1),
      projectId: z.string().min(1),
      goal: z.string().min(1).max(4000),
      provider: providerSchema,
      model: z.string().nullable(),
      effort: effortSchema.nullable(),
      permission: permissionSchema,
      parent: workerId.nullable(),
      base: worktreeBaseSchema
    })
    .strict(),
  z
    .object({
      ...commandBase,
      kind: z.literal('message'),
      workerId,
      text: z.string().min(1).max(8000),
      mode: z.enum(['next', 'steer'])
    })
    .strict(),
  z.object({ ...commandBase, kind: z.literal('stop'), workerId }).strict(),
  z
    .object({
      ...commandBase,
      kind: z.literal('approval'),
      workerId,
      requestId: z.string().min(1),
      decision: z.enum(['approve', 'deny'])
    })
    .strict()
])
export const commandRejectionSchema = z.enum([
  'remote_dispatch_disabled',
  'project_not_found',
  'agent_not_connected',
  'worker_not_found',
  'already_resolved',
  'expired',
  /** A dispatch that a later stop overtook before it ran. */
  'superseded',
  /** The receiver could not carry out a command it had no other reason to refuse. */
  'failed'
])
const receiptBase = {
  commandId: z.string().min(1).max(64),
  /** The permission a dispatch actually runs with; null for other commands. */
  permission: permissionSchema.nullable()
}
/** The receiver's answer to one command, written by the receiver. */
export const commandReceiptSchema = z.discriminatedUnion('result', [
  z.object({ ...receiptBase, result: z.literal('accepted'), reason: z.null() }).strict(),
  z
    .object({ ...receiptBase, result: z.literal('rejected'), reason: commandRejectionSchema })
    .strict()
])

export type DeviceCommand = z.infer<typeof deviceCommandSchema>
export type CommandRejection = z.infer<typeof commandRejectionSchema>
export type CommandReceipt = z.infer<typeof commandReceiptSchema>
