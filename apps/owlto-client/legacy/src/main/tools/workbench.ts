import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import type { SaveToWorkbenchInput } from '../../shared/workbench.js'
import { listWorkbenchWorkspaces, saveToWorkbench } from '../workbench/workbench-store.js'

const jsonRenderInputSchema = Type.Union([Type.Unknown(), Type.String()])

const jsonRenderCellSchema = Type.Object({
  renderer: Type.Literal('json-render'),
  cell_ui_json: jsonRenderInputSchema,
  detailed_ui_json: Type.Optional(jsonRenderInputSchema)
})

const saveToWorkbenchSchema = Type.Object({
  workspace_id: Type.String({
    description: 'Target Workbench workspace id. Use list_workbench_workspaces before saving.'
  }),
  id: Type.Optional(Type.String({ description: 'Existing cell id to overwrite.' })),
  cell: jsonRenderCellSchema
})

export function createWorkbenchTools(cwd: string): AgentTool[] {
  return [
    {
      name: 'list_workbench_workspaces',
      label: 'List Workbench Workspaces',
      description: 'List Workbench workspaces so you can choose where to save or inspect cards.',
      parameters: Type.Object({}),
      executionMode: 'sequential',
      async execute() {
        const result = await listWorkbenchWorkspaces()
        return {
          content: [
            {
              type: 'text',
              text: result.workspaces.map((workspace) => `- ${workspace.name}`).join('\n')
            }
          ],
          details: result
        }
      }
    },
    {
      name: 'save_to_workbench',
      label: 'Save to Workbench',
      description:
        'Save or update a Workbench card. Provide a tagged cell: { renderer: "json-render", cell_ui_json, detailed_ui_json? } where each UI is a JsonRenderDocument object or a local JSON file path.',
      parameters: saveToWorkbenchSchema,
      executionMode: 'sequential',
      async execute(_toolCallId, params) {
        const typedParams = params as SaveToWorkbenchInput
        if (!typedParams.workspace_id?.trim()) {
          throw new Error(
            'save_to_workbench requires workspace_id. Use list_workbench_workspaces first.'
          )
        }
        const result = await saveToWorkbench(typedParams, { pathBase: cwd })
        return {
          content: [
            {
              type: 'text',
              text: typedParams.id ? 'Updated Workbench card.' : 'Saved to Workbench.'
            }
          ],
          details: {
            id: result.cell.id,
            workspace_id: result.cell.workspace_id,
            renderer: result.cell.cell.renderer,
            cell_ui_tree_text: result.cell.cell_ui_tree_text
          }
        }
      }
    }
  ]
}
