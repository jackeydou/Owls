import type { Project } from '../../../shared/app'

/**
 * A project's icon tile: its initial, an emoji, or an image. Decorative, since the
 * project's name always sits beside it. The tile picks up `--owl-c` from its row.
 */
export function ProjectIcon({ project }: { project: Pick<Project, 'name' | 'settings'> }) {
  const icon = project.settings?.icon ?? { kind: 'letter' }
  const colored = project.settings?.color ? ' colored' : ''
  if (icon.kind === 'image')
    return (
      <b className="owls-project-icon image" aria-hidden="true">
        <img src={icon.src} alt="" draggable={false} />
      </b>
    )
  if (icon.kind === 'emoji')
    return (
      <b className={`owls-project-icon emoji${colored}`} aria-hidden="true">
        {icon.value}
      </b>
    )
  return (
    <b className={`owls-project-icon${colored}`} aria-hidden="true">
      {project.name.slice(0, 1).toUpperCase()}
    </b>
  )
}
