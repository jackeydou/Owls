import { ActionButton } from '@renderer/components/ui/action-button'
import {
  type RankedItem,
  RankedList,
  type RankedListCopy
} from '@renderer/components/ui/ranked-list'
import { RankedPicker, type RankedPickerCopy } from '@renderer/components/ui/ranked-picker'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import {
  type AgentProvider,
  allowedAgents,
  defaultProjectAgents,
  hasAgentChoice,
  type ProjectAgents,
  pickedModels,
  providerSchema,
  rankAll
} from '../../../shared/agents'
import type { AgentModel, Project } from '../../../shared/app'
import { AgentIcon } from '../router/AgentIcon'
import { SettingRow } from './SettingRow'
import { agentConnection, isAgentReady, useAppStore } from './store'

/** Screen reader text for the drag-to-order lists. */
function useRankedCopy(): RankedListCopy {
  const { t } = useTranslation()
  return useMemo(
    () => ({
      reorder: (name) => t('rankedList.reorder', { name }),
      instructions: t('rankedList.instructions'),
      picked: (name) => t('rankedList.picked', { name }),
      moved: (name, position) => t('rankedList.moved', { name, position }),
      dropped: (name, position) => t('rankedList.dropped', { name, position }),
      canceled: (name) => t('rankedList.canceled', { name })
    }),
    [t]
  )
}

/** Text for the model pickers. */
function usePickerCopy(ranked: RankedListCopy): RankedPickerCopy {
  const { t } = useTranslation()
  return useMemo(
    () => ({
      ...ranked,
      empty: t('projectAgents.noneChosen'),
      more: t('projectAgents.moreModels'),
      search: t('projectAgents.searchModels'),
      noMatch: t('projectAgents.noMatch'),
      standard: t('projectAgents.standardVariant'),
      add: (name) => t('projectAgents.addModel', { name })
    }),
    [ranked, t]
  )
}

/** Models a user can pick. Claude Code's "default" entry is an alias, not a model. */
const pickable = (provider: AgentProvider, models: AgentModel[]) =>
  provider === 'claude-code' ? models.filter((m) => !m.isDefault) : models

/** Which coding agents a project's workers use, and each agent's models, in the user's order. */
export function ProjectAgentsPage({ project }: { project: Project }) {
  const { t } = useTranslation()
  const saveProject = useAppStore((s) => s.saveProject)
  const copy = useRankedCopy()
  const pickerCopy = usePickerCopy(copy)
  const ready = useAppStore(
    useShallow((s) => providerSchema.options.filter((p) => isAgentReady(agentConnection(s, p))))
  )
  const codex = useAppStore((s) => s.connection.models)
  const claude = useAppStore((s) => s.claude.models)
  const cursor = useAppStore((s) => s.cursor.models)
  const offered: Record<AgentProvider, AgentModel[]> = {
    codex: pickable('codex', codex),
    'claude-code': pickable('claude-code', claude),
    cursor: pickable('cursor', cursor)
  }
  // Shown at once, so a dragged row stays where it was dropped while the save runs.
  const [agents, setAgents] = useState(project.settings.agents)
  useEffect(() => setAgents(project.settings.agents), [project.settings.agents])
  function save(next: ProjectAgents) {
    setAgents(next)
    return saveProject({
      id: project.id,
      name: project.name,
      settings: { ...project.settings, agents: next }
    })
  }
  const agentItems: RankedItem[] = rankAll(agents.order, providerSchema.options).map((a) => ({
    ...a,
    label: t(`agent.${a.id}`),
    icon: <AgentIcon provider={a.id} />,
    note: ready.includes(a.id) ? undefined : t('notConnected')
  }))
  const columns = allowedAgents(agents)
    .filter((p) => ready.includes(p))
    .sort(
      (a, b) => agentItems.findIndex((i) => i.id === a) - agentItems.findIndex((i) => i.id === b)
    )
  const configured =
    hasAgentChoice(agents) || providerSchema.options.some((p) => agents.models[p].some((m) => m.on))
  return (
    <section className="owlto-settings-section">
      <div className="owlto-section-heading">
        <div>
          <h2>{t('projectSettings.page.agents')}</h2>
          <p>{t('projectAgents.body')}</p>
        </div>
        {configured ? (
          <ActionButton
            size="sm"
            variant="outline"
            onAction={async () => ((await save(defaultProjectAgents)) ? 'done' : 'quiet')}
          >
            {t('projectAgents.reset')}
          </ActionButton>
        ) : null}
      </div>
      <SettingRow
        label={t('projectAgents.agents')}
        description={t('projectAgents.agentsHelp')}
        detail={
          <RankedList
            className="owlto-ranked-agents"
            items={agentItems}
            copy={copy}
            onChange={(items) =>
              void save({
                ...agents,
                order: items.map((i) => ({ id: providerSchema.parse(i.id), on: i.on }))
              })
            }
          />
        }
      />
      <SettingRow
        label={t('projectAgents.models')}
        description={t('projectAgents.modelsHelp')}
        detail={
          columns.length ? (
            <div className="owlto-ranked-columns">
              {columns.map((provider) => {
                const names = new Map(offered[provider].map((m) => [m.id, m.name]))
                const items = rankAll(
                  agents.models[provider],
                  offered[provider].map((m) => m.id)
                ).map((m) => ({
                  ...m,
                  label: names.get(m.id) ?? m.id,
                  note: names.has(m.id) ? undefined : t('projectAgents.unavailable')
                }))
                return (
                  <RankedPicker
                    key={provider}
                    header={
                      <>
                        <AgentIcon provider={provider} />
                        {t(`agent.${provider}`)}
                      </>
                    }
                    items={items}
                    copy={pickerCopy}
                    onChange={(next) =>
                      void save({
                        ...agents,
                        models: {
                          ...agents.models,
                          [provider]: pickedModels(next)
                        }
                      })
                    }
                  />
                )
              })}
            </div>
          ) : (
            <p className="owlto-note">{t('projectAgents.noModels')}</p>
          )
        }
      />
    </section>
  )
}
