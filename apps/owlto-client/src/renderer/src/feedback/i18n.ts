export const feedbackEn = {
  'feedback.open': 'Send feedback',
  'feedback.tooltip': 'Bug report, feedback, or feature request',
  'feedback.title': 'Send feedback',
  'feedback.lead':
    'Tell us what works and what doesn’t. Feedback is posted as a public issue in {{repository}} on GitHub.',
  'feedback.subject': 'Title',
  'feedback.subjectPlaceholder': 'Title (optional)',
  'feedback.body': 'Feedback',
  'feedback.bodyPlaceholder': 'What happened, or what would make Owlto better?',
  'feedback.diagnostics': 'Include app and system versions',
  'feedback.asUser': 'Posts as @{{login}}',
  'feedback.viaBrowser': 'Opens GitHub in your browser to submit.',
  'feedback.connect': 'Connect GitHub',
  'feedback.cancel': 'Cancel',
  'feedback.send': 'Send',
  'feedback.continueOnGitHub': 'Continue on GitHub',
  'feedback.failed': 'Owlto could not reach GitHub. Your feedback is kept here; try again.',
  'feedback.created': 'Sent as issue #{{number}}',
  'feedback.createdDetail': 'Thanks! You can follow it on GitHub.',
  'feedback.view': 'View on GitHub',
  'feedback.opened': 'Finish in your browser',
  'feedback.openedDetail':
    'GitHub opened with your feedback filled in. Click “Create” there to submit it.',
  'feedback.noAccess':
    'Your GitHub connection can’t create issues in this repository, so GitHub opened in your browser with your feedback filled in. Click “Create” there to submit it.',
  'feedback.done': 'Done'
}

export const feedbackZh: Record<keyof typeof feedbackEn, string> = {
  'feedback.open': '发送反馈',
  'feedback.tooltip': 'Bug 报告、反馈或功能建议',
  'feedback.title': '发送反馈',
  'feedback.lead':
    '告诉我们哪里好用、哪里不好用。反馈会作为公开 issue 发布在 GitHub 的 {{repository}}。',
  'feedback.subject': '标题',
  'feedback.subjectPlaceholder': '标题（可选）',
  'feedback.body': '反馈内容',
  'feedback.bodyPlaceholder': '遇到了什么问题，或者希望 Owlto 怎么改进？',
  'feedback.diagnostics': '附带应用与系统版本',
  'feedback.asUser': '以 @{{login}} 身份发布',
  'feedback.viaBrowser': '将在浏览器中打开 GitHub 提交。',
  'feedback.connect': '连接 GitHub',
  'feedback.cancel': '取消',
  'feedback.send': '发送',
  'feedback.continueOnGitHub': '去 GitHub 提交',
  'feedback.failed': '无法连接 GitHub，内容已保留，请稍后重试。',
  'feedback.created': '已提交为 issue #{{number}}',
  'feedback.createdDetail': '谢谢！你可以在 GitHub 上跟进这条反馈。',
  'feedback.view': '在 GitHub 查看',
  'feedback.opened': '请在浏览器中完成提交',
  'feedback.openedDetail':
    '已在浏览器打开 GitHub，并填好了你的反馈。在页面上点击“Create”即可提交。',
  'feedback.noAccess':
    '你当前的 GitHub 连接无法直接在这个仓库创建 issue，所以改为在浏览器打开 GitHub，并填好了你的反馈。在页面上点击“Create”即可提交。',
  'feedback.done': '完成'
}
