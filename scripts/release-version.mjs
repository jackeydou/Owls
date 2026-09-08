const encodedDateVersionPattern =
  /^(?<year>\d{4})\.(?<month>[1-9]|1[0-2])\.(?<patch>[1-9]\d*)(?:-beta\.(?<encodedBeta>[1-9]\d*))?$/

export function createReleaseVersion({ year, month, day, correction = 0, betaNumber = null }) {
  if (!Number.isInteger(year) || year < 2000) {
    throw new Error(`Invalid release year: ${year}`)
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid release month: ${month}`)
  }
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new Error(`Invalid release day: ${day}`)
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid release date: ${year}-${month}-${day}`)
  }
  if (!Number.isInteger(correction) || correction < 0 || correction > 99) {
    throw new Error(`Invalid release correction: ${correction}`)
  }
  if (betaNumber !== null && (!Number.isInteger(betaNumber) || betaNumber < 1)) {
    throw new Error(`Invalid beta number: ${betaNumber}`)
  }

  const baseVersion = `${year}.${month}.${day * 100 + correction}`
  return betaNumber === null ? baseVersion : `${baseVersion}-beta.${betaNumber}`
}

export function validateReleaseVersion(version) {
  const match = encodedDateVersionPattern.exec(version)
  if (!match?.groups?.patch) {
    return false
  }

  const patch = Number(match.groups.patch)
  const day = Math.floor(patch / 100)
  const correction = patch % 100
  const year = Number(match.groups.year)
  const month = Number(match.groups.month)
  const date = new Date(Date.UTC(year, month - 1, day))
  const dateIsValid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day

  return Number.isInteger(patch) && dateIsValid && correction >= 0 && correction <= 99
}

export function releaseVersionPolicyMessage() {
  return [
    'Use YYYY.M.PATCH for new Owls release versions, where PATCH = day * 100 + same-day correction number.',
    'For example, use 2026.5.2000 for May 20 and 2026.5.2001 for the first May 20 correction.',
    'Use -beta.N only for prereleases, for example 2026.5.2000-beta.1.',
    'Do not use YYYY.M.D-N because semver treats it as a prerelease of YYYY.M.D.'
  ].join(' ')
}
