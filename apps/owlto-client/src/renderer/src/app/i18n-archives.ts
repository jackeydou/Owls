/** Copy for archiving threads: the sidebar action and the Archives settings page. */
export const archivesEn = {
  'archives.title': 'Archives',
  'archives.body':
    'Archived threads leave the sidebar but keep their conversations. Sending a message in one brings it back.',
  'archives.none': 'No archived threads.',
  'archives.archivedOn': 'Archived {{date}}',
  'archives.open': 'Open {{title}}',
  'archives.delete': 'Delete for good',
  'errors.thread_busy': 'This thread is still working. Stop it first, then try again.',
  'archives.unarchive': 'Unarchive',
  'archives.archive': 'Archive',
  'archives.archived': 'Archived'
}

export const archivesZh: Record<keyof typeof archivesEn, string> = {
  'archives.title': '归档',
  'archives.body':
    '归档的 Thread 不在侧边栏显示，对话内容保留。在归档的 Thread 里发消息会让它回到侧边栏。',
  'archives.none': '没有归档的 Thread。',
  'archives.archivedOn': '归档于 {{date}}',
  'archives.open': '打开 {{title}}',
  'archives.delete': '彻底删除',
  'errors.thread_busy': '这个 Thread 还在运行，请先停止再试。',
  'archives.unarchive': '取消归档',
  'archives.archive': '归档',
  'archives.archived': '已归档'
}
