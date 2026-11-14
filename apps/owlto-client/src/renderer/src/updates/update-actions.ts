/** Button actions for updates, shaped for `ActionButton` (see components/ui/use-action.ts). */

/** Restarts into a downloaded update; the reply returns without quitting if the user keeps tasks. */
export async function installUpdate(): Promise<'quiet'> {
  const reply = await window.owlto.updates.install()
  if (!reply.ok) throw new Error(reply.error.code)
  return 'quiet'
}

export async function checkForUpdates(): Promise<'done' | 'quiet'> {
  const reply = await window.owlto.updates.check()
  if (!reply.ok) throw new Error(reply.error.code)
  // Downloading, ready, and failed results stay visible in the status line.
  return reply.value.state.status === 'up-to-date' ? 'done' : 'quiet'
}
