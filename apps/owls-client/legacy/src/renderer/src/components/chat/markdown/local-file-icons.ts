import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Folder,
  type LucideIcon,
  Presentation
} from 'lucide-react'

type LocalFileIconSpec = {
  Icon: LucideIcon
  kind: string
}

export function localDirectoryIconForPath(): LocalFileIconSpec {
  return { Icon: Folder, kind: 'directory' }
}

const imageExtensions = new Set([
  'apng',
  'avif',
  'bmp',
  'gif',
  'heic',
  'heif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'psd',
  'svg',
  'tif',
  'tiff',
  'webp'
])
const codeExtensions = new Set([
  'astro',
  'bash',
  'bat',
  'c',
  'cc',
  'cjs',
  'clj',
  'cmd',
  'cpp',
  'cs',
  'cts',
  'css',
  'dart',
  'diff',
  'ex',
  'exs',
  'fish',
  'fs',
  'go',
  'graphql',
  'h',
  'hpp',
  'hs',
  'html',
  'ipynb',
  'java',
  'js',
  'jsx',
  'kt',
  'less',
  'lua',
  'm',
  'mm',
  'mjs',
  'mts',
  'patch',
  'php',
  'pl',
  'pm',
  'ps1',
  'proto',
  'py',
  'rb',
  'rs',
  'sass',
  'scss',
  'sh',
  'sql',
  'svelte',
  'swift',
  'toml',
  'ts',
  'tsx',
  'vue',
  'xml',
  'yaml',
  'yml',
  'zig',
  'zsh'
])
const archiveExtensions = new Set([
  '7z',
  'br',
  'bz2',
  'dmg',
  'gz',
  'rar',
  'tar',
  'tgz',
  'txz',
  'xz',
  'zip',
  'zst'
])
const audioExtensions = new Set(['aac', 'aiff', 'flac', 'm4a', 'mp3', 'ogg', 'opus', 'wav', 'wma'])
const videoExtensions = new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'webm', 'wmv'])
const documentExtensions = new Set(['doc', 'docx', 'odt', 'pages'])
const presentationExtensions = new Set(['key', 'odp', 'ppt', 'pptx'])
const spreadsheetExtensions = new Set(['csv', 'numbers', 'ods', 'tsv', 'xls', 'xlsm', 'xlsx'])
const textExtensions = new Set(['log', 'md', 'mdx', 'rtf', 'tex', 'text', 'txt'])
const pdfExtensions = new Set(['pdf'])
const fontExtensions = new Set(['eot', 'otf', 'ttf', 'woff', 'woff2'])
const jsonExtensions = new Set(['json', 'json5', 'jsonc', 'jsonl', 'ndjson'])
const codeFilenames = new Set([
  'dockerfile',
  'gemfile',
  'justfile',
  'makefile',
  'rakefile',
  'vagrantfile'
])

function fileExtensionFromPath(path: string): string {
  const filename = path.split(/[\\/]/).filter(Boolean).pop() ?? path
  const lastDot = filename.lastIndexOf('.')
  if (lastDot <= 0 || lastDot === filename.length - 1) return ''
  return filename.slice(lastDot + 1).toLowerCase()
}

function filenameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop()?.toLowerCase() ?? path.toLowerCase()
}

export function localFileIconForPath(path: string): LocalFileIconSpec {
  const extension = fileExtensionFromPath(path)
  const filename = filenameFromPath(path)

  if (imageExtensions.has(extension)) return { Icon: FileImage, kind: 'image' }
  if (jsonExtensions.has(extension)) return { Icon: FileJson, kind: 'json' }
  if (codeExtensions.has(extension) || codeFilenames.has(filename)) {
    return { Icon: FileCode, kind: 'code' }
  }
  if (archiveExtensions.has(extension)) return { Icon: FileArchive, kind: 'archive' }
  if (audioExtensions.has(extension)) return { Icon: FileAudio, kind: 'audio' }
  if (videoExtensions.has(extension)) return { Icon: FileVideo, kind: 'video' }
  if (documentExtensions.has(extension)) return { Icon: FileText, kind: 'document' }
  if (presentationExtensions.has(extension)) return { Icon: Presentation, kind: 'presentation' }
  if (spreadsheetExtensions.has(extension)) return { Icon: FileSpreadsheet, kind: 'spreadsheet' }
  if (textExtensions.has(extension)) return { Icon: FileText, kind: 'text' }
  if (pdfExtensions.has(extension)) return { Icon: FileText, kind: 'pdf' }
  if (fontExtensions.has(extension)) return { Icon: FileType, kind: 'font' }
  return { Icon: File, kind: 'file' }
}
