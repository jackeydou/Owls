import brow from '../../../../resources/app-logos/brow.png'
import line from '../../../../resources/app-logos/line.png'
import solid from '../../../../resources/app-logos/solid.png'
import type { AppLogo } from '../../../shared/codex'
import { useCodexStore } from './store'

export const appLogoIcons: Record<AppLogo, string> = { line, solid, brow }

export function AppLogoMark() {
  const logo = useCodexStore((s) => s.settings.appLogo)
  return <img src={appLogoIcons[logo]} data-logo={logo} alt="" />
}
