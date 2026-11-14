import { ipcMain } from 'electron'
import type { ToolApprovalResolveRequest } from '../../shared/tool-approval.js'
import {
  listPendingToolApprovalRequests,
  resolveToolApprovalRequest
} from '../tool-approval-engine.js'

export function registerToolApprovalIpcHandlers(): void {
  ipcMain.handle('tool-approval:list', () => listPendingToolApprovalRequests())

  ipcMain.handle(
    'tool-approval:resolve',
    async (_, payload: Partial<ToolApprovalResolveRequest>) => {
      const id = payload.id?.trim()
      if (!id) {
        throw new Error('Approval request id is required')
      }
      if (payload.behavior !== 'allow' && payload.behavior !== 'deny') {
        throw new Error('Approval behavior must be allow or deny')
      }
      return await resolveToolApprovalRequest(
        id,
        payload.behavior,
        payload.reason?.trim() || undefined,
        { rememberRule: payload.rememberRule === true }
      )
    }
  )
}
