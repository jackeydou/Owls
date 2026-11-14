import { is } from '@electron-toolkit/utils'
import { app, type BrowserWindow, Menu, type MenuItemConstructorOptions, shell } from 'electron'
import type { AppSettings } from '../../shared/app.js'
import type { MenuCommand } from '../../shared/menu.js'
import { UPDATE_FEED_REPOSITORY } from '../../shared/updates.js'

const REPOSITORY_URL = `https://github.com/${UPDATE_FEED_REPOSITORY}`

const labels = {
  en: {
    about: 'About Owls',
    settings: 'Settings…',
    updates: 'Check for Updates…',
    services: 'Services',
    hide: 'Hide Owls',
    hideOthers: 'Hide Others',
    showAll: 'Show All',
    quit: 'Quit Owls',
    file: 'File',
    newThread: 'New Thread',
    newProject: 'New Project…',
    cloneProject: 'Open GitHub Project…',
    openFolder: 'Open Folder…',
    close: 'Close Window',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    pasteAndMatchStyle: 'Paste and Match Style',
    delete: 'Delete',
    selectAll: 'Select All',
    speech: 'Speech',
    startSpeaking: 'Start Speaking',
    stopSpeaking: 'Stop Speaking',
    view: 'View',
    toggleSidebar: 'Toggle Sidebar',
    toggleProjects: 'Toggle Right Sidebar',
    overview: 'Overview',
    cards: 'Cards',
    pullRequests: 'Pull Requests',
    actualSize: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    fullScreen: 'Toggle Full Screen',
    reload: 'Reload',
    devTools: 'Toggle Developer Tools',
    window: 'Window',
    help: 'Help',
    docs: 'Documentation',
    whatsNew: 'What’s New',
    feedback: 'Report an Issue…'
  },
  'zh-CN': {
    about: '关于 Owls',
    settings: '设置…',
    updates: '检查更新…',
    services: '服务',
    hide: '隐藏 Owls',
    hideOthers: '隐藏其他',
    showAll: '全部显示',
    quit: '退出 Owls',
    file: '文件',
    newThread: '新对话',
    newProject: '新建项目…',
    cloneProject: '打开 GitHub 项目…',
    openFolder: '打开文件夹…',
    close: '关闭窗口',
    edit: '编辑',
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '拷贝',
    paste: '粘贴',
    pasteAndMatchStyle: '粘贴并匹配样式',
    delete: '删除',
    selectAll: '全选',
    speech: '语音',
    startSpeaking: '开始朗读',
    stopSpeaking: '停止朗读',
    view: '显示',
    toggleSidebar: '切换侧边栏',
    toggleProjects: '切换右侧边栏',
    overview: '全景',
    cards: '卡片',
    pullRequests: 'Pull Requests',
    actualSize: '实际大小',
    zoomIn: '放大',
    zoomOut: '缩小',
    fullScreen: '切换全屏幕',
    reload: '重新载入',
    devTools: '切换开发者工具',
    window: '窗口',
    help: '帮助',
    docs: '使用文档',
    whatsNew: '新功能',
    feedback: '反馈问题…'
  }
} satisfies Record<AppSettings['language'], Record<string, string>>

export type MenuDeps = {
  window: () => BrowserWindow | null
  checkForUpdates: () => void
}

/**
 * The macOS application menu. Items that open a view send a `MenuCommand` to the renderer,
 * which owns navigation; the rest use native roles. Other platforms keep Electron's default
 * menu, and their shortcuts stay in the renderer.
 */
export function applyAppMenu(settings: AppSettings, deps: MenuDeps): void {
  if (process.platform !== 'darwin') return
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(settings, deps)))
}

function menuTemplate(settings: AppSettings, deps: MenuDeps): MenuItemConstructorOptions[] {
  const l = labels[settings.language]
  const send = (command: MenuCommand) => {
    const window = deps.window()
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.webContents.send('owls:menu-command', command)
  }
  const command = (
    label: string,
    name: MenuCommand,
    accelerator?: string
  ): MenuItemConstructorOptions => ({ label, accelerator, click: () => send(name) })
  const link = (label: string, url: string): MenuItemConstructorOptions => ({
    label,
    click: () => void shell.openExternal(url)
  })
  return [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: l.about },
        { type: 'separator' },
        command(l.settings, 'settings', 'Cmd+,'),
        {
          label: l.updates,
          click: () => {
            deps.checkForUpdates()
            send('updates')
          }
        },
        { type: 'separator' },
        { role: 'services', label: l.services },
        { type: 'separator' },
        { role: 'hide', label: l.hide },
        { role: 'hideOthers', label: l.hideOthers },
        { role: 'unhide', label: l.showAll },
        { type: 'separator' },
        { role: 'quit', label: l.quit }
      ]
    },
    {
      label: l.file,
      submenu: [
        command(l.newThread, 'new-thread', 'Cmd+N'),
        command(l.newProject, 'new-project'),
        command(l.cloneProject, 'clone-project'),
        command(l.openFolder, 'open-folder', 'Cmd+O'),
        { type: 'separator' },
        { role: 'close', label: l.close }
      ]
    },
    {
      label: l.edit,
      submenu: [
        { role: 'undo', label: l.undo },
        { role: 'redo', label: l.redo },
        { type: 'separator' },
        { role: 'cut', label: l.cut },
        { role: 'copy', label: l.copy },
        { role: 'paste', label: l.paste },
        { role: 'pasteAndMatchStyle', label: l.pasteAndMatchStyle },
        { role: 'delete', label: l.delete },
        { role: 'selectAll', label: l.selectAll },
        { type: 'separator' },
        {
          label: l.speech,
          submenu: [
            { role: 'startSpeaking', label: l.startSpeaking },
            { role: 'stopSpeaking', label: l.stopSpeaking }
          ]
        }
      ]
    },
    {
      label: l.view,
      submenu: [
        command(l.toggleSidebar, 'toggle-sidebar', 'Cmd+B'),
        command(l.toggleProjects, 'toggle-projects', 'Alt+Cmd+B'),
        { type: 'separator' },
        command(l.overview, 'toggle-overview', 'Cmd+J'),
        command(l.cards, 'toggle-cards', 'Cmd+K'),
        ...(settings.pullRequestsVisible ? [command(l.pullRequests, 'pull-requests')] : []),
        { type: 'separator' },
        { role: 'resetZoom', label: l.actualSize },
        { role: 'zoomIn', label: l.zoomIn },
        { role: 'zoomOut', label: l.zoomOut },
        { type: 'separator' },
        { role: 'togglefullscreen', label: l.fullScreen },
        ...(is.dev
          ? ([
              { type: 'separator' },
              { role: 'reload', label: l.reload },
              { role: 'toggleDevTools', label: l.devTools }
            ] satisfies MenuItemConstructorOptions[])
          : [])
      ]
    },
    // macOS fills the window menu with its own items and the open windows.
    { role: 'windowMenu', label: l.window },
    {
      // The help role makes macOS add its menu search field.
      role: 'help',
      label: l.help,
      submenu: [
        link(l.docs, `${REPOSITORY_URL}#readme`),
        link(l.whatsNew, `${REPOSITORY_URL}/releases`),
        { type: 'separator' },
        link(l.feedback, `${REPOSITORY_URL}/issues/new`)
      ]
    }
  ]
}
