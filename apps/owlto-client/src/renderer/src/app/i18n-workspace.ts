/** Copy for the Workspace: its row beside projects, its settings page, and the promote prompt. */
export const workspaceEn = {
  'workspace.name': 'Workspace',
  'workspace.settings': 'Workspace settings',
  'workspace.tooltip': 'Tasks outside any project · {{path}}',
  'workspace.page.title': 'Workspace',
  'workspace.page.body':
    'Tasks that belong to no project run here. Make a folder its own project to track it separately; its past tasks, pull requests, and token usage move with it.',
  'workspace.agentsBody': 'Which agents and models workers use for tasks in the Workspace.',
  'workspace.pages': 'Workspace pages',
  'workspace.folders': 'Folders',
  'workspace.foldersBody': 'Top-level folders in the workspace.',
  'workspace.foldersEmpty': 'No folders yet. Tasks create one each.',
  'workspace.foldersLoading': 'Reading folders…',
  'workspace.git': 'Git',
  'workspace.isProject': 'Project',
  'workspace.promote': 'Make project',
  'workspace.promoted': 'Made project',
  'workspace.mergeBack': 'Merge into Workspace',
  'workspace.merged': 'Merged',
  'workspace.mergeBackTitle': 'Merge into Workspace',
  'workspace.mergeBackBody':
    'Stop tracking this folder as its own project. Its tasks, pull requests, and token usage count under the Workspace again. The folder and its files stay.',
  'workspace.prompt': '{{name}} is a git repository',
  'workspace.promptDismiss': 'Not now for {{name}}',
  'workspace.openSettings': 'Open project settings for {{project}}'
}

export const workspaceZh: Record<keyof typeof workspaceEn, string> = {
  'workspace.name': 'Workspace',
  'workspace.settings': 'Workspace 设置',
  'workspace.tooltip': '不属于任何项目的任务 · {{path}}',
  'workspace.page.title': 'Workspace',
  'workspace.page.body':
    '不属于任何项目的任务在这里运行。把某个文件夹设为项目后会单独统计，它以前的任务、PR 和 token 用量也会一起迁过去。',
  'workspace.agentsBody': 'Workspace 里的任务使用哪些 Agent 和模型。',
  'workspace.pages': 'Workspace 的设置页',
  'workspace.folders': '文件夹',
  'workspace.foldersBody': 'Workspace 下的一级文件夹。',
  'workspace.foldersEmpty': '还没有文件夹，每个任务会新建一个。',
  'workspace.foldersLoading': '正在读取文件夹…',
  'workspace.git': 'Git',
  'workspace.isProject': '项目',
  'workspace.promote': '设为项目',
  'workspace.promoted': '已设为项目',
  'workspace.mergeBack': '并回 Workspace',
  'workspace.merged': '已并回',
  'workspace.mergeBackTitle': '并回 Workspace',
  'workspace.mergeBackBody':
    '不再把这个文件夹当作独立项目。它的任务、PR 和 token 用量会重新算在 Workspace 下，文件夹和里面的文件都会保留。',
  'workspace.prompt': '{{name}} 是 git 仓库',
  'workspace.promptDismiss': '暂不把 {{name}} 设为项目',
  'workspace.openSettings': '打开 {{project}} 的项目设置'
}
