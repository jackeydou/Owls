import { useI18n } from '@renderer/lib/i18n'
import { useProjectsStore } from '@renderer/stores/projects-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useCallback, useMemo, useState } from 'react'
import type { ProjectEntry } from '../../../../preload/index.d'
import { getEmptyChatGreetingKey } from './MessageBubble'

export function useProjectWorkState({
  dataRoot,
  workingDirectory
}: {
  dataRoot: string
  workingDirectory: string
}) {
  const { t } = useI18n()
  const projects = useProjectsStore((state) => state.projects)
  const addExistingProjectFolder = useProjectsStore((state) => state.addExistingFolder)
  const touchProject = useProjectsStore((state) => state.touch)
  const updateWorkingDirectory = useSettingsStore((state) => state.updateWorkingDirectory)
  const [emptyGreetingKey] = useState(() => getEmptyChatGreetingKey(new Date().getHours()))
  const currentProject = useMemo(
    () => projects.find((project) => project.path === workingDirectory) ?? null,
    [projects, workingDirectory]
  )
  const emptyChatGreeting = t(emptyGreetingKey, {
    name: '',
    separator: ''
  })
  const emptyChatTitle = currentProject
    ? t('chat.greeting.project', { project: currentProject.name })
    : emptyChatGreeting

  const handleSelectProject = useCallback(
    (project: ProjectEntry): void => {
      void (async () => {
        await touchProject(project.path)
        await updateWorkingDirectory(project.path)
      })().catch(console.error)
    },
    [touchProject, updateWorkingDirectory]
  )

  const handleAddProjectFromHome = useCallback((): void => {
    void (async () => {
      const project = await addExistingProjectFolder()
      if (!project) return
      await updateWorkingDirectory(project.path)
    })().catch(console.error)
  }, [addExistingProjectFolder, updateWorkingDirectory])

  const handleWorkLocally = useCallback((): void => {
    void (async () => {
      await updateWorkingDirectory(dataRoot)
    })().catch(console.error)
  }, [dataRoot, updateWorkingDirectory])

  return {
    currentProject,
    emptyChatTitle,
    handleAddProjectFromHome,
    handleSelectProject,
    handleWorkLocally,
    projects
  }
}
