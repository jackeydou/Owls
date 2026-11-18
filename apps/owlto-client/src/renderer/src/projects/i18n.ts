/** Copy for the Projects page: the Workspace and every project as cards. */
export const projectsPageEn = {
  'projectsPage.title': 'Projects',
  'projectsPage.subtitle': 'Where workers run your tasks',
  'projectsPage.list': 'Projects',
  'projectsPage.default': 'Default',
  'projectsPage.workspaceHint':
    'Your default working folder. Tasks that belong to no project run here.',
  'projectsPage.noDescription': 'No description',
  'projectsPage.open': 'Open {{project}}',
  'projectsPage.edit': 'Edit {{project}}',
  'projectsPage.threads_one': '{{count}} thread',
  'projectsPage.threads_other': '{{count}} threads',
  'projectsPage.noThreads': 'No threads yet',
  'projectsPage.working_one': '{{count}} working',
  'projectsPage.working_other': '{{count}} working',
  'projectsPage.waiting_one': '{{count}} needs you',
  'projectsPage.waiting_other': '{{count}} need you',
  'projectsPage.emptyTitle': 'Add your first project',
  'projectsPage.emptyBody':
    'Open a folder on your computer, clone a GitHub repository, or start an empty project. Workers then work inside it.'
}

export const projectsPageZh: Record<keyof typeof projectsPageEn, string> = {
  'projectsPage.title': '项目',
  'projectsPage.subtitle': 'Worker 在这些地方完成你的任务',
  'projectsPage.list': '项目',
  'projectsPage.default': '默认',
  'projectsPage.workspaceHint': '默认的工作目录，不属于任何项目的任务都在这里运行。',
  'projectsPage.noDescription': '暂无描述',
  'projectsPage.open': '打开 {{project}}',
  'projectsPage.edit': '编辑 {{project}}',
  'projectsPage.threads_one': '{{count}} 个对话',
  'projectsPage.threads_other': '{{count}} 个对话',
  'projectsPage.noThreads': '还没有对话',
  'projectsPage.working_one': '{{count}} 个进行中',
  'projectsPage.working_other': '{{count}} 个进行中',
  'projectsPage.waiting_one': '{{count}} 个等你处理',
  'projectsPage.waiting_other': '{{count}} 个等你处理',
  'projectsPage.emptyTitle': '添加你的第一个项目',
  'projectsPage.emptyBody':
    '打开本机的文件夹、克隆 GitHub 仓库，或者新建一个空项目，之后 Worker 就会在项目里工作。'
}
