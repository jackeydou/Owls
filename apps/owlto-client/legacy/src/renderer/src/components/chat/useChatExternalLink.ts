import { useEmbeddedBrowserStore } from '@renderer/stores/embedded-browser-store'
import { useSessionStore } from '@renderer/stores/session-store'
import { useTeamStore } from '@renderer/stores/team-store'
import { useCallback } from 'react'
import { normalizeWebTargetUrl } from '../../../../shared/web-targets'

export type ChatLinkOpenTarget = 'default' | 'embedded' | 'external'
export type ChatLinkOpener = (url: string, target?: ChatLinkOpenTarget) => void

function isLocalBrowserTarget(url: string): boolean {
  return url.startsWith('file://')
}

function isLoopbackBrowserTarget(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    const normalizedHost = hostname.toLowerCase()
    return (
      normalizedHost === 'localhost' ||
      normalizedHost.endsWith('.localhost') ||
      normalizedHost === '0.0.0.0' ||
      normalizedHost === '[::1]' ||
      normalizedHost === '::1' ||
      normalizedHost.startsWith('127.')
    )
  } catch {
    return false
  }
}

function shouldDefaultOpenInEmbeddedBrowser(url: string): boolean {
  return isLocalBrowserTarget(url) || isLoopbackBrowserTarget(url)
}

function localPathFromFileUrl(url: string): string | null {
  if (!isLocalBrowserTarget(url)) return null
  try {
    return decodeURIComponent(new URL(url).pathname)
  } catch {
    return null
  }
}

export function useChatExternalLink() {
  const openEmbeddedBrowserUrl = useEmbeddedBrowserStore((state) => state.openUrl)

  return useCallback(
    (url: string, target: ChatLinkOpenTarget = 'default') => {
      const normalizedUrl = normalizeWebTargetUrl(url)
      if (!normalizedUrl) {
        console.warn('[useChatExternalLink] Blocked opening unnormalized url:', url)
        return
      }

      const openInEmbeddedBrowser = () => {
        const sessionState = useSessionStore.getState()
        if (sessionState.filePanelOpen) {
          sessionState.toggleFilePanel()
        }

        const teamState = useTeamStore.getState()
        if (teamState.open) {
          teamState.toggleOpen()
        }

        const browserState = useEmbeddedBrowserStore.getState()
        const sessionKey = browserState.activeSessionKey
        openEmbeddedBrowserUrl(normalizedUrl, sessionKey)
        void window.api.embeddedBrowser.open({ sessionKey, url: normalizedUrl }).catch((error) => {
          useEmbeddedBrowserStore
            .getState()
            .setError(error instanceof Error ? error.message : String(error), sessionKey)
        })
      }

      const openExternally = () => {
        const localPath = localPathFromFileUrl(normalizedUrl)
        if (localPath) {
          void window.api.attachments.open(localPath).catch(console.error)
          return
        }
        void window.api.app.openExternal(normalizedUrl).catch(console.error)
      }

      if (target === 'embedded') {
        openInEmbeddedBrowser()
        return
      }

      if (target === 'external') {
        openExternally()
        return
      }

      if (isLocalBrowserTarget(normalizedUrl)) {
        openInEmbeddedBrowser()
        return
      }

      if (shouldDefaultOpenInEmbeddedBrowser(normalizedUrl)) {
        openInEmbeddedBrowser()
        return
      }

      openExternally()
    },
    [openEmbeddedBrowserUrl]
  )
}
