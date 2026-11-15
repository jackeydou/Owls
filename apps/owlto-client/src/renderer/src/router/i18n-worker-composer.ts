/** Copy for writing to a worker from its panel: the input, attachments, and delivery notes. */
export const workerComposerEn = {
  'workerComposer.label': 'Message {{title}}',
  'workerComposer.placeholder': 'Tell this worker… Markdown and pasted images work',
  'workerComposer.send': 'Send to this worker',
  'workerComposer.attach': 'Attach files',
  'workerComposer.attachments': 'Attached files',
  'workerComposer.remove': 'Remove {{name}}',
  'workerComposer.staging': 'Adding {{name}}…',
  'workerComposer.failed': '{{name}} could not be added',
  'workerComposer.tooLarge': '{{name}} is larger than {{limit}} MB.',
  'workerComposer.tooMany': 'A message can carry up to {{limit}} files.',
  'workerComposer.stageFailed': '{{name}} could not be added. Try again.',
  'workerComposer.queuedNote':
    'Cursor cannot take messages while it works. This one is delivered when the current turn ends.',
  'workerComposer.removed': 'This worker was removed, so it cannot take messages.',
  'workerComposer.open': 'Open {{name}}',
  'workerComposer.you': 'You'
}

export const workerComposerZh: Record<keyof typeof workerComposerEn, string> = {
  'workerComposer.label': '给 {{title}} 发消息',
  'workerComposer.placeholder': '告诉这个 Worker…支持 Markdown 和粘贴图片',
  'workerComposer.send': '发送给这个 Worker',
  'workerComposer.attach': '上传文件',
  'workerComposer.attachments': '附件',
  'workerComposer.remove': '移除 {{name}}',
  'workerComposer.staging': '正在添加 {{name}}…',
  'workerComposer.failed': '{{name}} 添加失败',
  'workerComposer.tooLarge': '{{name}} 超过 {{limit}} MB。',
  'workerComposer.tooMany': '一条消息最多带 {{limit}} 个文件。',
  'workerComposer.stageFailed': '{{name}} 添加失败，请重试。',
  'workerComposer.queuedNote': 'Cursor 运行时无法接收新消息，这条会在当前这一轮结束后送达。',
  'workerComposer.removed': '这个 Worker 已移除，无法再接收消息。',
  'workerComposer.open': '打开 {{name}}',
  'workerComposer.you': '你'
}
