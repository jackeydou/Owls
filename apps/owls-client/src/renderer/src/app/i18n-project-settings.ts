/** Copy for one project's settings pages. */
export const projectSettingsEn = {
  'projectSettings.group': 'Projects',
  'projectSettings.open': 'Settings for {{project}}',
  'projectSettings.missing': 'This project is no longer in Owls.',
  'projectSettings.page.general': 'General',
  'projectSettings.page.git': 'Git',
  'projectSettings.page.instructions': 'Instructions',
  'projectSettings.pages': 'Pages for {{project}}',
  'projectSettings.name': 'Name',
  'projectSettings.nameHelp':
    'How the project appears in Owls and to the Router. The folder keeps its name.',
  'projectSettings.icon': 'Icon',
  'projectSettings.iconHelp': 'Shown next to the project wherever it is listed.',
  'projectSettings.icon.letter': 'Initial',
  'projectSettings.icon.emoji': 'Emoji',
  'projectSettings.icon.image': 'Image',
  'projectSettings.icon.emojiLabel': 'Emoji or short text',
  'projectSettings.icon.replace': 'Replace image',
  'projectSettings.icon.failed': 'Owls could not read this image. Try a PNG, JPEG, WebP, or GIF.',
  'projectSettings.color': 'Color',
  'projectSettings.color.auto': 'Automatic color',
  'projectSettings.color.option': 'Color {{number}}',
  'projectSettings.location': 'Location',
  'projectSettings.locationHelp': 'The folder workers run in, or branch worktrees from.',
  'projectSettings.description': 'Description',
  'projectSettings.descriptionHelp':
    'What this project is. The Router reads it when it picks a project for a task.',
  'projectSettings.descriptionPlaceholder': 'For example: the marketing site, built with Astro.',
  'projectSettings.gitBody':
    'How workers that can change files get their own git worktree in this project.',
  'projectSettings.worktreesOff':
    'Worktrees are off in Router settings, so workers use the project folder until they are turned on.',
  'projectSettings.openRouterSettings': 'Open Router settings',
  'projectSettings.notGit':
    'This project is not a git repository with a commit yet, so workers run in its folder and these settings do not apply.',
  'projectSettings.loadingRefs': 'Reading branches…',
  'projectSettings.baseBranch': 'Branch new worktrees from',
  'projectSettings.baseBranchHelp':
    'Each worker starts from this branch. A remote branch is fetched first, so work starts from its latest commit. Tasks the Router starts from a parent worker or the default branch keep their own base.',
  'projectSettings.baseBranch.head': 'Current branch',
  'projectSettings.remoteBranches': 'Remote branches',
  'projectSettings.localBranches': 'Local branches',
  'projectSettings.remote': 'Remote',
  'projectSettings.remoteHelp':
    'Where workers push when a task asks them to, and where Owls looks for their pull requests.',
  'projectSettings.deletePushedBranches': 'Delete pushed branches on remove',
  'projectSettings.deletePushedBranchesHelp':
    'When you remove a worker, also delete its local branch once all its commits are on the remote. Branches with commits found nowhere else are always kept.',
  'projectSettings.on': 'On',
  'projectSettings.off': 'Off',
  'projectSettings.instructionsBody':
    'Extra instructions for every worker in this project. Workers follow them over their default habits.',
  'projectSettings.instructions.general': 'General instructions',
  'projectSettings.instructions.generalHelp': 'Sent to every worker in this project.',
  'projectSettings.instructions.codeReview': 'Code review preferences',
  'projectSettings.instructions.codeReviewHelp': 'Used when a worker reviews code.',
  'projectSettings.instructions.pullRequest': 'Pull request preferences',
  'projectSettings.instructions.pullRequestHelp':
    'Used when a worker opens or updates a pull request.',
  'projectSettings.instructionsPlaceholder':
    'Add your preferences here. Workers will be told to follow them over their default instructions.',
  'projectSettings.expand': 'Show {{name}}',
  'projectSettings.collapse': 'Hide {{name}}'
}

export const projectSettingsZh: Record<keyof typeof projectSettingsEn, string> = {
  'projectSettings.group': '项目',
  'projectSettings.open': '{{project}} 的设置',
  'projectSettings.missing': '这个项目已经不在 Owls 中了。',
  'projectSettings.page.general': '基本信息',
  'projectSettings.page.git': 'Git',
  'projectSettings.page.instructions': '指令',
  'projectSettings.pages': '{{project}} 的设置页',
  'projectSettings.name': '名称',
  'projectSettings.nameHelp': '项目在 Owls 和 Router 中显示的名字，不会改动文件夹名。',
  'projectSettings.icon': '图标',
  'projectSettings.iconHelp': '在所有列出项目的地方显示在项目名旁边。',
  'projectSettings.icon.letter': '首字母',
  'projectSettings.icon.emoji': 'Emoji',
  'projectSettings.icon.image': '图片',
  'projectSettings.icon.emojiLabel': 'Emoji 或短文字',
  'projectSettings.icon.replace': '更换图片',
  'projectSettings.icon.failed': 'Owls 无法读取这张图片，请换一张 PNG、JPEG、WebP 或 GIF。',
  'projectSettings.color': '颜色',
  'projectSettings.color.auto': '自动颜色',
  'projectSettings.color.option': '颜色 {{number}}',
  'projectSettings.location': '位置',
  'projectSettings.locationHelp': 'Worker 在这个文件夹中运行，或从它创建 worktree。',
  'projectSettings.description': '描述',
  'projectSettings.descriptionHelp': '这个项目是做什么的。Router 为任务选择项目时会参考它。',
  'projectSettings.descriptionPlaceholder': '例如：公司官网，使用 Astro 构建。',
  'projectSettings.gitBody': '可修改文件的 Worker 在这个项目中如何获得自己的 git worktree。',
  'projectSettings.worktreesOff':
    'Router 设置中已关闭 worktree，在重新打开之前，Worker 会直接使用项目文件夹。',
  'projectSettings.openRouterSettings': '打开 Router 设置',
  'projectSettings.notGit':
    '这个项目还不是有提交记录的 git 仓库，Worker 会直接在文件夹中运行，这些设置不会生效。',
  'projectSettings.loadingRefs': '正在读取分支…',
  'projectSettings.baseBranch': '新 worktree 的起始分支',
  'projectSettings.baseBranchHelp':
    '每个 Worker 从这个分支开始。远程分支会先 fetch，确保从最新提交开始。Router 指定从父 Worker 或默认分支开始的任务不受影响。',
  'projectSettings.baseBranch.head': '当前分支',
  'projectSettings.remoteBranches': '远程分支',
  'projectSettings.localBranches': '本地分支',
  'projectSettings.remote': '远程仓库',
  'projectSettings.remoteHelp':
    '任务要求推送时 Worker 推送到这里，Owls 也在这里查找它们的 Pull Request。',
  'projectSettings.deletePushedBranches': '移除时删除已推送的分支',
  'projectSettings.deletePushedBranchesHelp':
    '移除 Worker 时，如果它的提交都已在远程仓库中，同时删除本地分支。含有其他地方都没有的提交的分支始终保留。',
  'projectSettings.on': '开启',
  'projectSettings.off': '关闭',
  'projectSettings.instructionsBody': '给这个项目中每个 Worker 的额外指令，优先于它们的默认习惯。',
  'projectSettings.instructions.general': '通用指令',
  'projectSettings.instructions.generalHelp': '发送给这个项目中的每个 Worker。',
  'projectSettings.instructions.codeReview': 'Code Review 偏好',
  'projectSettings.instructions.codeReviewHelp': 'Worker 审查代码时使用。',
  'projectSettings.instructions.pullRequest': 'Pull Request 偏好',
  'projectSettings.instructions.pullRequestHelp': 'Worker 创建或更新 Pull Request 时使用。',
  'projectSettings.instructionsPlaceholder':
    '在这里写下你的偏好。Worker 会被告知优先遵循它们，而不是默认指令。',
  'projectSettings.expand': '展开{{name}}',
  'projectSettings.collapse': '收起{{name}}'
}
