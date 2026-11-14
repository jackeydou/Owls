/** Copy for the profile settings page. */
export const profileEn = {
  'profile.title': 'Profile',
  'profile.name': 'Name',
  'profile.nameHelp': 'Shown on the Overview.',
  'profile.namePlaceholder': 'You',
  'profile.avatar': 'Avatar',
  'profile.avatarHelp': 'Shown on the Overview and next to your messages.',
  'profile.avatarFromGitHub': 'From GitHub @{{login}}',
  'profile.upload': 'Upload image',
  'profile.useGitHub': 'Use GitHub avatar',
  'profile.reset': 'Use default owl',
  'profile.uploadFailed': 'Owlto could not read this image. Try a PNG, JPEG, WebP, or GIF.',
  'errors.avatar_unavailable': 'Could not get your GitHub avatar. Try again later.'
}

export const profileZh: Record<keyof typeof profileEn, string> = {
  'profile.title': '个人资料',
  'profile.name': '名字',
  'profile.nameHelp': '显示在全景图上。',
  'profile.namePlaceholder': '你',
  'profile.avatar': '头像',
  'profile.avatarHelp': '显示在全景图和你的消息旁边。',
  'profile.avatarFromGitHub': '来自 GitHub @{{login}}',
  'profile.upload': '上传图片',
  'profile.useGitHub': '使用 GitHub 头像',
  'profile.reset': '使用默认猫头鹰',
  'profile.uploadFailed': 'Owlto 无法读取这张图片，请试试 PNG、JPEG、WebP 或 GIF。',
  'errors.avatar_unavailable': '无法获取 GitHub 头像，请稍后再试。'
}
