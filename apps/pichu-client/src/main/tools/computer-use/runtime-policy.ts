import { app } from 'electron'
import { isDebugPackage } from '../../../shared/build-mode.js'
import { isComputerUseHelperAvailable } from './helper-client.js'

const COMPUTER_USE_HELPER_UNAVAILABLE_MESSAGE =
  'Computer Use requires the Owls Computer Use helper for macOS screen and input permissions. This build does not include the helper yet.'

export function isInProcessComputerUseAllowed(): boolean {
  return isDebugPackage || app.getVersion().includes('-beta')
}

export function assertComputerUseRuntimeAvailable(): void {
  if (!isComputerUseHelperAvailable() && !isInProcessComputerUseAllowed()) {
    throw new Error(COMPUTER_USE_HELPER_UNAVAILABLE_MESSAGE)
  }
}
