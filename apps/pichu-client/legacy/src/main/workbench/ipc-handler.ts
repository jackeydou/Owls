import { ipcMain } from 'electron'
import type {
  CreateWorkbenchWorkspaceInput,
  DeleteWorkbenchCellInput,
  GetWorkbenchCellInput,
  ListWorkbenchInput,
  RunWorkbenchCellInput,
  SaveToWorkbenchInput,
  SetCurrentWorkbenchWorkspaceInput,
  UpdateWorkbenchLayoutInput
} from '../../shared/workbench.js'
import {
  createWorkbenchWorkspace,
  deleteWorkbenchCell,
  getWorkbenchCell,
  listWorkbench,
  listWorkbenchWorkspaces,
  runWorkbenchCell,
  saveToWorkbench,
  setCurrentWorkbenchWorkspace,
  updateWorkbenchLayout
} from './workbench-store.js'

export function registerWorkbenchIpc(): void {
  ipcMain.handle('workbench:create-workspace', (_, input: CreateWorkbenchWorkspaceInput) => {
    return createWorkbenchWorkspace(input)
  })
  ipcMain.handle('workbench:list-workspaces', () => {
    return listWorkbenchWorkspaces()
  })
  ipcMain.handle(
    'workbench:set-current-workspace',
    (_, input: SetCurrentWorkbenchWorkspaceInput) => {
      return setCurrentWorkbenchWorkspace(input)
    }
  )
  ipcMain.handle('workbench:save', (_, input: SaveToWorkbenchInput) => {
    return saveToWorkbench(input)
  })
  ipcMain.handle('workbench:list', (_, input?: ListWorkbenchInput) => {
    return listWorkbench(input ?? {})
  })
  ipcMain.handle('workbench:get-cell', (_, input: GetWorkbenchCellInput) => {
    return getWorkbenchCell(input)
  })
  ipcMain.handle('workbench:delete-cell', (_, input: DeleteWorkbenchCellInput) => {
    return deleteWorkbenchCell(input)
  })
  ipcMain.handle('workbench:update-layout', (_, input: UpdateWorkbenchLayoutInput) => {
    return updateWorkbenchLayout(input)
  })
  ipcMain.handle('workbench:run-cell', (_, input: RunWorkbenchCellInput) => {
    return runWorkbenchCell(input)
  })
}
