// Site-wide constants. Change SITE_URL when the site moves to its own domain:
// canonical links, hreflang, the sitemap, Open Graph URLs, and llms.txt all derive from it.
export const SITE_URL = 'https://owlto.dev'

export const REPO_URL = 'https://github.com/jackeydou/Owls'
export const RELEASES_URL = `${REPO_URL}/releases`
// Direct download of the newest stable installer. GitHub's `latest` release
// skips prereleases, and the Release macOS workflow attaches a copy of the DMG
// under this fixed name to every stable release, so the link never needs edits.
export const STABLE_DMG_NAME = 'Owlto.dmg'
export const DOWNLOAD_URL = `${RELEASES_URL}/latest/download/${STABLE_DMG_NAME}`
export const ISSUES_URL = `${REPO_URL}/issues`
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`
export const CONTRIBUTING_URL = `${REPO_URL}/blob/main/CONTRIBUTING.md`

// Locale routes. `path` is the directory under the site root, `prefix` the
// relative path from that directory back to the root (assets stay relative so
// the site works on a sub-path such as GitHub Pages project sites).
export const LOCALES = [
  { code: 'en', htmlLang: 'en', ogLocale: 'en_US', path: '', prefix: './', label: 'English' },
  {
    code: 'zh',
    htmlLang: 'zh-Hans',
    ogLocale: 'zh_CN',
    path: 'zh/',
    prefix: '../',
    label: '简体中文'
  }
]

export const localeUrl = (locale) => `${SITE_URL}/${locale.path}`
