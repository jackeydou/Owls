import { FolderIcon } from '@renderer/components/ui/icons'

/** The Workspace's icon tile, shaped like a project's so the two line up. Decorative. */
export function WorkspaceIcon() {
  return (
    <b className="owlto-project-icon workspace" aria-hidden="true">
      <FolderIcon size={12} />
    </b>
  )
}
