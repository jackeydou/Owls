import duoCream from '../../../../resources/app-logos/duo-cream.png'
import duoNight from '../../../../resources/app-logos/duo-night.png'
import duoWhite from '../../../../resources/app-logos/duo-white.png'
import leanCream from '../../../../resources/app-logos/lean-cream.png'
import leanNight from '../../../../resources/app-logos/lean-night.png'
import leanWhite from '../../../../resources/app-logos/lean-white.png'
import trioCream from '../../../../resources/app-logos/trio-cream.png'
import trioNight from '../../../../resources/app-logos/trio-night.png'
import trioWhite from '../../../../resources/app-logos/trio-white.png'
import type { AppLogo } from '../../../shared/app'
import { useAppStore } from './store'

export const appLogoIcons: Record<AppLogo, string> = {
  'duo-white': duoWhite,
  'duo-night': duoNight,
  'duo-cream': duoCream,
  'lean-white': leanWhite,
  'lean-night': leanNight,
  'lean-cream': leanCream,
  'trio-white': trioWhite,
  'trio-night': trioNight,
  'trio-cream': trioCream
}

export function AppLogoMark() {
  const logo = useAppStore((s) => s.settings.appLogo)
  return <img src={appLogoIcons[logo]} data-logo={logo} alt="" />
}
