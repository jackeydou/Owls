const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/** Keep in sync with NOTES_ICLOUD_CONTAINER in src/main/cards/icloud.ts and the iOS entitlements. */
const ICLOUD_CONTAINER = 'iCloud.dev.owlto.app'

/**
 * Info.plist keys that show the container's Documents folder in iCloud Drive as "Owlto".
 * Harmless in a build without the iCloud entitlement.
 */
function icloudInfoPlist() {
  return {
    NSUbiquitousContainers: {
      [ICLOUD_CONTAINER]: {
        NSUbiquitousContainerIsDocumentScopePublic: true,
        NSUbiquitousContainerName: 'Owlto',
        NSUbiquitousContainerSupportedFolderLevels: 'Any'
      }
    }
  }
}

const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * The main app's entitlements with iCloud Documents added. These are restricted
 * entitlements: macOS kills an app that claims them without a matching embedded
 * provisioning profile, so they go only into builds that embed one, and only on the
 * main app, never the helpers (`entitlementsInherit`).
 */
function icloudEntitlements(baseEntitlements, teamId, appId) {
  if (!/^[A-Z0-9]{10}$/.test(teamId))
    throw new Error('APPLE_TEAM_ID must be a 10-character team id.')
  const container = `<string>${escapeXml(ICLOUD_CONTAINER)}</string>`
  const keys = [
    `<key>com.apple.application-identifier</key>\n    <string>${teamId}.${escapeXml(appId)}</string>`,
    `<key>com.apple.developer.team-identifier</key>\n    <string>${teamId}</string>`,
    `<key>com.apple.developer.icloud-container-identifiers</key>\n    <array>${container}</array>`,
    `<key>com.apple.developer.ubiquity-container-identifiers</key>\n    <array>${container}</array>`,
    '<key>com.apple.developer.icloud-services</key>\n    <array><string>CloudDocuments</string></array>',
    '<key>com.apple.developer.icloud-container-environment</key>\n    <string>Production</string>'
  ]
  const closing = baseEntitlements.lastIndexOf('</dict>')
  if (closing < 0) throw new Error('The base entitlements have no top-level <dict>.')
  return `${baseEntitlements.slice(0, closing)}    ${keys.join('\n    ')}\n  ${baseEntitlements.slice(closing)}`
}

/**
 * The signing options for iCloud, or null for a build without it. A release build gets
 * iCloud when CI hands it a Developer ID provisioning profile with the iCloud capability
 * (OWLTO_MAC_PROVISIONING_PROFILE) and the team id. Without them the app builds and runs
 * as before, and Settings → Notes says this build cannot use iCloud.
 */
function icloudSigning({ profile, teamId, appId, baseEntitlementsPath }) {
  if (!profile || !teamId) return null
  if (!fs.existsSync(profile))
    throw new Error(`The provisioning profile ${profile} does not exist.`)
  const output = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'owlto-entitlements-')),
    'entitlements.mac.plist'
  )
  fs.writeFileSync(
    output,
    icloudEntitlements(fs.readFileSync(baseEntitlementsPath, 'utf8'), teamId, appId)
  )
  return { provisioningProfile: profile, entitlements: output }
}

module.exports = { ICLOUD_CONTAINER, icloudEntitlements, icloudInfoPlist, icloudSigning }
