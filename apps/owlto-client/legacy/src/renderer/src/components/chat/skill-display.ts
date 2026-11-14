export function formatSkillDisplayTitle(name: string): string {
  return name
    .split(/[-_:\s]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
}
