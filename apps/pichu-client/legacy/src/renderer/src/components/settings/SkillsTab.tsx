import type { SkillSummary } from '@renderer/../../preload/index.d'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { type I18nKey, useI18n } from '@renderer/lib/i18n'
import { usePluginStore } from '@renderer/stores/plugin-store'
import { ChevronDown, Loader2, MoreHorizontal, Search, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { TypewriterShowcase, type TypewriterShowcaseItem } from './TypewriterShowcase'

type SkillsBySource = {
  pichu: SkillSummary[]
  repo: SkillSummary[]
  agents: SkillSummary[]
  claude: SkillSummary[]
  plugin: SkillSummary[]
}

function groupSkillsBySource(skills: SkillSummary[]): SkillsBySource {
  const result: SkillsBySource = { pichu: [], repo: [], agents: [], claude: [], plugin: [] }
  for (const skill of skills) {
    if (skill.sourceKind === 'builtin') {
      result.pichu.push(skill)
      continue
    }

    if (skill.sourceKind in result) {
      result[skill.sourceKind].push(skill)
    }
  }
  return result
}

type SkillSection = {
  key: keyof SkillsBySource
  title: string
  description?: string
  empty: string
}

function skillSections(t: (key: I18nKey) => string): SkillSection[] {
  return [
    {
      key: 'pichu',
      title: 'Owls skills',
      empty: 'No Owls skills deployed yet.'
    },
    {
      key: 'plugin',
      title: 'Plugin skills',
      description: 'Skills bundled by installed and enabled marketplace plugins.',
      empty: 'No plugin skills available.'
    },
    {
      key: 'repo',
      title: t('skills.project.title'),
      description: t('skills.project.description'),
      empty: t('skills.project.empty')
    },
    {
      key: 'agents',
      title: 'Agent skills',
      description: 'User-level skills loaded from ~/.agents/skills.',
      empty: 'No skills found in ~/.agents/skills.'
    },
    {
      key: 'claude',
      title: 'Claude skills',
      description: 'User-level skills loaded from ~/.claude/skills.',
      empty: 'No skills found in ~/.claude/skills.'
    }
  ]
}

const fallbackSkillShowcaseItems: TypewriterShowcaseItem[] = [
  {
    id: 'polish',
    kind: 'skill',
    token: '/polish',
    label: 'polish',
    body: 'tighten the settings UI copy, spacing, and hover states without changing behavior.'
  },
  {
    id: 'audit',
    kind: 'skill',
    token: '/audit',
    label: 'audit',
    body: 'review this plugin marketplace flow for confusing states and missing affordances.'
  },
  {
    id: 'document',
    kind: 'skill',
    token: '/document',
    label: 'document',
    body: 'write a concise operator guide for installing and disabling plugins.'
  }
]

function skillShowcaseItems(skills: SkillSummary[]): TypewriterShowcaseItem[] {
  const dynamicItems = skills.slice(0, 3).map((skill) => ({
    id: skill.qualifiedName ?? skill.filePath,
    kind: 'skill' as const,
    token: `/${skill.qualifiedName ?? skill.name}`,
    label: skill.name,
    body: `help me ${skill.description.replace(/\.$/, '').toLowerCase()}.`
  }))

  return dynamicItems.length > 0 ? dynamicItems : fallbackSkillShowcaseItems
}

function SkillCardMenu({
  skill,
  busy,
  pluginEnabled,
  onToggleEnabled,
  onUninstall
}: {
  skill: SkillSummary
  busy: boolean
  pluginEnabled?: boolean
  onToggleEnabled: (skill: SkillSummary) => void
  onUninstall: (skill: SkillSummary) => void
}) {
  const [open, setOpen] = useState(false)
  const canUninstall = skill.sourceKind === 'pichu' || Boolean(skill.pluginId)
  const canToggle = Boolean(skill.pluginId)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          aria-label={`More actions for ${skill.name}`}
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background/80 text-muted-foreground opacity-0 shadow-sm ring-1 ring-border/60 transition hover:bg-card-muted hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 disabled:cursor-wait disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" strokeWidth={1.8} />
          ) : (
            <MoreHorizontal className="size-4" strokeWidth={1.8} />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" className="w-36">
        <DropdownMenuItem
          disabled={!canToggle}
          title={canToggle ? undefined : 'Only plugin skills can be enabled or disabled here'}
          className="px-3 py-2 text-[12px] text-muted-foreground"
          onSelect={() => {
            if (!canToggle) return
            onToggleEnabled(skill)
          }}
        >
          {pluginEnabled === false ? 'Enable' : 'Disable'}
        </DropdownMenuItem>
        <DropdownMenuItem
          danger
          disabled={!canUninstall}
          title={canUninstall ? undefined : 'Only Owls and plugin skills can be uninstalled here'}
          className="px-3 py-2 text-[12px] text-destructive"
          onSelect={() => {
            if (!canUninstall) return
            onUninstall(skill)
          }}
        >
          Uninstall
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SkillCard({
  skill,
  busy,
  pluginEnabled,
  onToggleEnabled,
  onUninstall
}: {
  skill: SkillSummary
  busy: boolean
  pluginEnabled?: boolean
  onToggleEnabled: (skill: SkillSummary) => void
  onUninstall: (skill: SkillSummary) => void
}) {
  return (
    <div className="group flex min-w-0 items-center gap-3 rounded-2xl px-3 py-2.5 transition hover:bg-foreground/4">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-violet-100 via-fuchsia-100 to-amber-100 text-violet-700 shadow-sm ring-1 ring-white/60">
        <Sparkles className="size-4" strokeWidth={1.8} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-foreground">{skill.name}</div>
        <div className="mt-0.5 line-clamp-1 text-[12px] text-muted-foreground">
          {skill.description}
        </div>
      </div>
      <SkillCardMenu
        skill={skill}
        busy={busy}
        pluginEnabled={pluginEnabled}
        onToggleEnabled={onToggleEnabled}
        onUninstall={onUninstall}
      />
    </div>
  )
}

function SkillGrid({
  skills,
  busyKey,
  pluginEnabledById,
  onToggleEnabled,
  onUninstall
}: {
  skills: SkillSummary[]
  busyKey: string | null
  pluginEnabledById: Map<string, boolean>
  onToggleEnabled: (skill: SkillSummary) => void
  onUninstall: (skill: SkillSummary) => void
}): React.JSX.Element {
  return (
    <div className="mt-2 grid grid-cols-1 gap-x-5 gap-y-1 md:grid-cols-2">
      {skills.map((skill) => (
        <SkillCard
          key={skill.qualifiedName ?? skill.filePath}
          skill={skill}
          busy={busyKey === (skill.pluginId ?? skill.name)}
          pluginEnabled={skill.pluginId ? pluginEnabledById.get(skill.pluginId) : undefined}
          onToggleEnabled={onToggleEnabled}
          onUninstall={onUninstall}
        />
      ))}
    </div>
  )
}

export function SkillsTab(): React.JSX.Element {
  const { t } = useI18n()
  const sections = useMemo(() => skillSections(t), [t])
  const [grouped, setGrouped] = useState<SkillsBySource>({
    pichu: [],
    repo: [],
    agents: [],
    claude: [],
    plugin: []
  })
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<'all' | keyof SkillsBySource>('all')
  const installed = usePluginStore((state) => state.installed)
  const reloadInstalledPlugins = usePluginStore((state) => state.reloadInstalledPlugins)

  const pluginEnabledById = useMemo(
    () => new Map(installed.map((plugin) => [plugin.id, plugin.enabled])),
    [installed]
  )

  const fetchSkills = useCallback(async () => {
    setError(null)
    try {
      const result = await window.api.agent.listSkills()
      setGrouped(groupSkillsBySource(result.skills))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void Promise.all([fetchSkills(), reloadInstalledPlugins()]).catch(() => {})
  }, [fetchSkills, reloadInstalledPlugins])

  const handleToggleSkill = useCallback(
    async (skill: SkillSummary) => {
      if (!skill.pluginId) return

      setBusyKey(skill.pluginId)
      setError(null)
      try {
        if (pluginEnabledById.get(skill.pluginId) === false) {
          await window.api.plugins.enable(skill.pluginId)
        } else {
          await window.api.plugins.disable(skill.pluginId)
        }
        await reloadInstalledPlugins()
        await fetchSkills()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusyKey(null)
      }
    },
    [fetchSkills, pluginEnabledById, reloadInstalledPlugins]
  )

  const handleUninstallSkill = useCallback(
    async (skill: SkillSummary) => {
      if (skill.sourceKind === 'pichu') {
        if (!window.confirm(`Uninstall ${skill.name}?`)) return

        setBusyKey(skill.name)
        setError(null)
        try {
          await window.api.agent.deleteSkill(skill.name)
          await fetchSkills()
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusyKey(null)
        }
        return
      }

      if (!skill.pluginId) return
      if (!window.confirm(`Uninstall ${skill.pluginName ?? skill.name}?`)) return

      setBusyKey(skill.pluginId)
      setError(null)
      try {
        await window.api.plugins.uninstall(skill.pluginId)
        await reloadInstalledPlugins()
        await fetchSkills()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusyKey(null)
      }
    },
    [fetchSkills, reloadInstalledPlugins]
  )

  const filteredGrouped = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const result: SkillsBySource = { pichu: [], repo: [], agents: [], claude: [], plugin: [] }

    for (const section of sections) {
      result[section.key] = grouped[section.key].filter((skill) => {
        if (!normalizedQuery) return true

        const searchableText = [
          skill.name,
          skill.qualifiedName,
          skill.description,
          skill.sourceKind,
          skill.sourceLabel,
          skill.pluginName,
          skill.pluginVersion,
          ...(skill.pluginCommands ?? []).flatMap((command) => [command.name, command.description])
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()

        return searchableText.includes(normalizedQuery)
      })
    }

    return result
  }, [grouped, query, sections])

  const visibleSections = useMemo(
    () =>
      sourceFilter === 'all'
        ? sections
        : sections.filter((section) => section.key === sourceFilter),
    [sections, sourceFilter]
  )
  const visibleSkills = useMemo(
    () => visibleSections.flatMap((section) => filteredGrouped[section.key]),
    [filteredGrouped, visibleSections]
  )
  const showcaseItems = useMemo(() => skillShowcaseItems(visibleSkills), [visibleSkills])

  const totalSkills = visibleSections.reduce(
    (count, section) => count + filteredGrouped[section.key].length,
    0
  )
  const hasFilters = query.trim().length > 0 || sourceFilter !== 'all'

  return (
    <div>
      <div className="text-center">
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          Make Owls work your way
        </h1>
      </div>

      <div className="mt-5 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search skills"
            className="h-9 w-full rounded-xl border border-border/70 bg-card px-8 text-[13px] outline-none transition placeholder:text-muted-foreground/60 focus:border-border-strong focus:ring-2 focus:ring-foreground/5"
          />
        </div>
        <label className="relative">
          <select
            value={sourceFilter}
            onChange={(event) =>
              setSourceFilter(event.target.value as 'all' | keyof SkillsBySource)
            }
            className="h-9 appearance-none rounded-xl border border-border/70 bg-card py-0 pl-3 pr-8 text-[12px] font-medium text-foreground outline-none transition focus:border-border-strong focus:ring-2 focus:ring-foreground/5"
          >
            <option value="all">All sources</option>
            {sections.map((section) => (
              <option key={section.key} value={section.key}>
                {section.title}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        </label>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
          {error}
        </div>
      ) : null}

      <TypewriterShowcase items={showcaseItems} />

      <div className="mt-5 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-foreground">Available skills</h2>
        <div className="text-[12px] text-muted-foreground">
          {loading ? 'Loading...' : `${totalSkills} total`}
        </div>
      </div>

      {visibleSections.map((section) => {
        const skills = filteredGrouped[section.key]
        return (
          <section key={section.key} className="mt-5">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h3 className="text-[13px] font-semibold text-foreground">{section.title}</h3>
                {section.description ? (
                  <p className="mt-0.5 text-[12px] text-muted-foreground">{section.description}</p>
                ) : null}
              </div>
              <span className="text-[12px] text-muted-foreground">
                {loading ? '...' : skills.length}
              </span>
            </div>

            {loading ? (
              <div className="mt-2 rounded-2xl border border-dashed border-border/70 bg-card-muted/40 px-4 py-8 text-center text-[13px] text-muted-foreground">
                Loading skills...
              </div>
            ) : skills.length === 0 ? (
              <div className="mt-2 rounded-2xl border border-dashed border-border/70 bg-card-muted/40 px-4 py-8 text-center text-[13px] text-muted-foreground">
                {hasFilters ? 'No skills match your filters.' : section.empty}
              </div>
            ) : (
              <SkillGrid
                skills={skills}
                busyKey={busyKey}
                pluginEnabledById={pluginEnabledById}
                onToggleEnabled={(skill) => void handleToggleSkill(skill)}
                onUninstall={(skill) => void handleUninstallSkill(skill)}
              />
            )}
          </section>
        )
      })}
    </div>
  )
}
