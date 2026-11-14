export async function copyTextToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // Fall back to the selection-based copy path when Electron denies async clipboard access.
    }
  }

  const textArea = document.createElement('textarea')
  textArea.value = value
  textArea.setAttribute('readonly', '')
  textArea.style.position = 'fixed'
  textArea.style.left = '-9999px'
  document.body.appendChild(textArea)
  textArea.select()

  try {
    const copied = document.execCommand('copy')
    if (!copied) {
      throw new Error('Clipboard copy command was rejected')
    }
  } finally {
    document.body.removeChild(textArea)
  }
}
