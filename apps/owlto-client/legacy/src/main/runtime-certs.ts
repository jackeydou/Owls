import { existsSync } from 'node:fs'

function existingFile(path: string | undefined): string | null {
  return path && existsSync(path) ? path : null
}

function hostCaBundleCandidates(): string[] {
  return [
    process.env.SSL_CERT_FILE,
    process.env.REQUESTS_CA_BUNDLE,
    '/opt/homebrew/etc/openssl@3/cert.pem',
    '/opt/homebrew/etc/ca-certificates/cert.pem',
    '/usr/local/etc/openssl@3/cert.pem',
    '/usr/local/etc/ca-certificates/cert.pem',
    '/etc/ssl/certs/ca-certificates.crt'
  ].filter((path): path is string => Boolean(path))
}

export function findDefaultRuntimeCaBundlePath(): string | null {
  for (const candidate of hostCaBundleCandidates()) {
    const path = existingFile(candidate)
    if (path) return path
  }

  return null
}
