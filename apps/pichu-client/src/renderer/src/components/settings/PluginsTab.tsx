import type {
  InstalledPlugin,
  PluginMarketplace,
  PluginMarketplaceEntry,
  PluginMarketplaceSkillSummary,
  SkillSummary
} from '@renderer/../../preload/index.d'
import { MarkdownRenderer } from '@renderer/components/chat/MarkdownRenderer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Switch } from '@renderer/components/ui/switch'
import { Toast, type ToastVariant, ToastViewport } from '@renderer/components/ui/toast'
import { type I18nKey, useI18n } from '@renderer/lib/i18n'
import { pluginLogoUrl } from '@renderer/lib/plugin-assets'
import { cn } from '@renderer/lib/utils'
import { usePluginStore } from '@renderer/stores/plugin-store'
import {
  Check,
  ChevronDown,
  CircleSlash,
  Loader2,
  MoreHorizontal,
  Package,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  X
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import pichuMark from '../../../../../resources/pichu-mark.png?asset'
import { TypewriterShowcase, type TypewriterShowcaseItem } from './TypewriterShowcase'

type CatalogItem = {
  key: string
  name: string
  title: string
  description: string
  category: string
  marketplaceName: string
  brandColor?: string
  logoSrc?: string
  installed?: InstalledPlugin
  available?: PluginMarketplaceEntry
  hasUpdate?: boolean
  updateLabel?: string
  hookCapability?: HookCapabilitySummary
}

type DisplaySkillSummary = SkillSummary | PluginMarketplaceSkillSummary

type PluginActionLabels = {
  disable: string
  disabled: string
  enable: string
  install: string
  moreActions: (title: string) => string
  notAvailable: string
  update: string
  reinstall: string
  updateAvailable: string
  uninstall: string
}

type HookCapabilitySummary = {
  eventCount: number
  matcherGroupCount: number
  commandCount: number
}

type InstallToastState = {
  id: number
  title: string
  description?: string
  variant: ToastVariant
}

type PluginStatusToastState = {
  id: number
  title: string
}

type SkillPreviewState = {
  skill: DisplaySkillSummary
  content: string | null
  loading: boolean
  error: string | null
}

type PluginsPageMode = 'browse' | 'manage' | 'pluginDetail'

type PluginManageTab = 'plugins' | 'skills'

type Translate = (key: I18nKey, options?: Record<string, unknown>) => string

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function previewMarkdown(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
}

function marketplaceWarningsFromRefresh(marketplaces: PluginMarketplace[]): string[] {
  const messages: string[] = []
  for (const marketplace of marketplaces) {
    for (const diagnostic of marketplace.diagnostics ?? []) {
      if (diagnostic.level === 'error' || diagnostic.level === 'warning') {
        messages.push(diagnostic.message)
      }
    }
  }
  return [...new Set(messages)]
}

function isPluginAuthInstallError(error: unknown): boolean {
  return /plugin auth|auth\./i.test(errorMessage(error))
}

function pluginInstallAuthFailureDiagnostic(plugin: InstalledPlugin): string | null {
  return (
    plugin.diagnostics.find((diagnostic) => diagnostic.message.includes('Plugin auth failed:'))
      ?.message ?? null
  )
}

function catalogKey(name: string): string {
  return name
}

function getInstalledTitle(plugin: InstalledPlugin): string {
  return plugin.manifest.interface?.displayName ?? plugin.name
}

function getInstalledDescription(plugin: InstalledPlugin): string {
  return (
    plugin.manifest.interface?.shortDescription ||
    plugin.manifest.description ||
    'Extend Owls with commands, skills, and integrations.'
  )
}

function getPluginLongDescription(item: CatalogItem): string {
  return item.installed?.manifest.description || item.available?.description || item.description
}

function getEntryDescription(entry: PluginMarketplaceEntry): string {
  if (entry.interface?.shortDescription || entry.description) {
    return entry.interface?.shortDescription ?? entry.description ?? ''
  }
  const category = entry.category ? `${entry.category} plugin` : 'Plugin'
  return `${category} from ${entry.marketplaceName}.`
}

function normalizePluginCategory(_pluginName: string, category: string | undefined): string {
  const normalizedCategory = category?.trim()
  return normalizedCategory || 'Featured'
}

function hookCapabilitySummary(plugin: InstalledPlugin): HookCapabilitySummary | undefined {
  const hookDeclarations = plugin.manifest.hookDeclarations ?? []
  if (hookDeclarations.length === 0) return undefined

  const events = new Set<string>()
  let matcherGroupCount = 0
  let commandCount = 0
  for (const declaration of hookDeclarations) {
    matcherGroupCount += declaration.matcherGroupCount
    commandCount += declaration.commandCount
    for (const event of declaration.events) {
      events.add(event.event)
    }
  }

  return {
    eventCount: events.size,
    matcherGroupCount,
    commandCount
  }
}

function pluginCapabilityLabels(item: CatalogItem, t: Translate): string[] {
  const manifest = item.installed?.manifest
  const labels: string[] = []

  if (manifest?.apps) labels.push(t('plugins.detail.capability.app'))
  if (manifest?.skills) labels.push(t('plugins.skills'))
  if (manifest?.mcpServers) labels.push(t('plugins.detail.capability.mcp'))
  if (manifest?.commands?.length) labels.push(t('plugins.detail.capability.commands'))
  if (manifest?.hookDeclarations?.length) labels.push(t('plugins.detail.capability.hooks'))

  return labels.length ? labels : [t('plugins.detail.capability.plugin')]
}

function compareVersionStrings(left: string | undefined, right: string | undefined): number {
  if (!left || !right) return 0
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: 'base'
  })
}

function PluginIcon({ item, className }: { item: CatalogItem; className?: string }) {
  const [failedLogoSrc, setFailedLogoSrc] = useState<string | null>(null)
  const logoSrc = item.logoSrc && item.logoSrc !== failedLogoSrc ? item.logoSrc : undefined

  return (
    <div
      className={cn(
        'relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl text-[12px] font-semibold text-foreground',
        logoSrc
          ? 'border border-border bg-white shadow-none dark:border-[#3a3a3a] dark:bg-[#171717]'
          : 'bg-linear-to-br from-sky-200 via-violet-200 to-fuchsia-200 shadow-sm',
        className
      )}
      style={
        !logoSrc && item.brandColor ? { background: item.brandColor, color: 'white' } : undefined
      }
    >
      {logoSrc ? (
        <img
          key={logoSrc}
          src={logoSrc}
          alt={`${item.title} logo`}
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailedLogoSrc(logoSrc)}
        />
      ) : (
        <Package className="size-[45%]" strokeWidth={1.8} />
      )}
    </div>
  )
}

function PluginActionMenu({
  item,
  busy,
  onToggleEnabled,
  onUpdate,
  onReinstall,
  onUninstall,
  labels,
  triggerClassName
}: {
  item: CatalogItem
  busy: boolean
  onToggleEnabled: (plugin: InstalledPlugin) => void
  onUpdate: (plugin: InstalledPlugin) => void
  onReinstall: (plugin: InstalledPlugin) => void
  onUninstall: (plugin: InstalledPlugin) => void
  labels: PluginActionLabels
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const installed = item.installed

  if (!installed) return null

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          aria-label={labels.moreActions(item.title)}
          className={cn(
            moreActionButtonClassName,
            triggerClassName ??
              'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100'
          )}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" strokeWidth={1.8} />
          ) : (
            <MoreHorizontal className="size-3.5" strokeWidth={1.8} />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" className="w-36">
        {item.hasUpdate ? (
          <DropdownMenuItem
            className="px-3 py-2 text-[12px] font-medium"
            onSelect={() => onUpdate(installed)}
          >
            {labels.update}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          className="px-3 py-2 text-[12px] text-muted-foreground"
          onSelect={() => onReinstall(installed)}
        >
          {labels.reinstall}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="px-3 py-2 text-[12px] text-muted-foreground"
          onSelect={() => onToggleEnabled(installed)}
        >
          {installed.enabled ? labels.disable : labels.enable}
        </DropdownMenuItem>
        <DropdownMenuItem
          danger
          className="px-3 py-2 text-[12px] text-destructive"
          onSelect={() => onUninstall(installed)}
        >
          {labels.uninstall}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const moreActionButtonClassName =
  'flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-foreground/8 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/10 data-[state=open]:bg-foreground/10 data-[state=open]:text-foreground disabled:cursor-wait disabled:opacity-50'

function CatalogCard({
  item,
  busy,
  onInstall,
  onOpenDetails,
  onToggleEnabled,
  onUpdate,
  onReinstall,
  onUninstall,
  labels
}: {
  item: CatalogItem
  busy: boolean
  onInstall: (entry: PluginMarketplaceEntry) => void
  onOpenDetails: (item: CatalogItem) => void
  onToggleEnabled: (plugin: InstalledPlugin) => void
  onUpdate: (plugin: InstalledPlugin) => void
  onReinstall: (plugin: InstalledPlugin) => void
  onUninstall: (plugin: InstalledPlugin) => void
  labels: PluginActionLabels
}) {
  const { t } = useI18n()
  const disabled = item.available?.policy?.installation === 'NOT_AVAILABLE'
  const installedDisabled = item.installed ? !item.installed.enabled : false

  return (
    <div
      className={cn(
        'group flex min-w-0 items-center gap-3 rounded-2xl px-3 py-2.5 transition hover:bg-foreground/4',
        installedDisabled && 'bg-foreground/2.5'
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none"
        onClick={() => onOpenDetails(item)}
      >
        <PluginIcon
          item={item}
          className={installedDisabled ? 'opacity-60 grayscale' : undefined}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <div
              className={cn(
                'truncate text-[13px] font-semibold text-foreground',
                installedDisabled && 'text-muted-foreground'
              )}
            >
              {item.title}
            </div>
            {installedDisabled ? (
              <span className="shrink-0 rounded-full border border-border/70 bg-background px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
                {labels.disabled}
              </span>
            ) : null}
          </div>
          {item.hasUpdate ? (
            <div className="mt-0.5 line-clamp-1 text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
              {labels.updateAvailable}
              {item.updateLabel ? ` · ${item.updateLabel}` : null}
            </div>
          ) : (
            <>
              <div
                className={cn(
                  'mt-0.5 line-clamp-2 text-[12px] leading-4 text-muted-foreground',
                  installedDisabled && 'text-muted-foreground/75'
                )}
              >
                {item.description}
              </div>
              {item.hookCapability ? (
                <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  {t('plugins.hooks.enabled')}
                </div>
              ) : null}
            </>
          )}
        </div>
      </button>
      {item.installed ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="flex size-5 shrink-0 items-center justify-center">
            {installedDisabled ? (
              <CircleSlash
                className={cn('size-4 text-muted-foreground', busy && 'opacity-0')}
                strokeWidth={1.8}
              />
            ) : (
              <Check
                className={cn('size-4 text-muted-foreground', busy && 'opacity-0')}
                strokeWidth={1.8}
              />
            )}
          </div>
          <PluginActionMenu
            item={item}
            busy={busy}
            onToggleEnabled={onToggleEnabled}
            onUpdate={onUpdate}
            onReinstall={onReinstall}
            onUninstall={onUninstall}
            labels={labels}
            triggerClassName="opacity-100"
          />
        </div>
      ) : (
        <button
          type="button"
          disabled={!item.available || disabled || busy}
          aria-label={disabled ? labels.notAvailable : labels.install}
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground/5 text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => {
            if (item.available) onInstall(item.available)
          }}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" strokeWidth={1.8} />
          ) : (
            <Plus className="size-4" strokeWidth={1.8} />
          )}
        </button>
      )}
    </div>
  )
}

function PluginInstallDialog({
  item,
  busy,
  onClose,
  onConfirm
}: {
  item: CatalogItem
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const { t } = useI18n()
  const hasAuth = Boolean(item.available?.auth)
  const developerName =
    item.available?.interface?.developerName ??
    item.installed?.manifest.interface?.developerName ??
    item.marketplaceName

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/40 px-4 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugin-install-title"
        className="relative flex max-h-[78vh] w-full max-w-[540px] flex-col overflow-hidden rounded-3xl border border-border/70 bg-background shadow-2xl"
      >
        <button
          type="button"
          disabled={busy}
          aria-label={t('plugins.installDialog.close')}
          className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-xl bg-foreground/5 text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground disabled:opacity-50"
          onClick={onClose}
        >
          <X className="size-4" strokeWidth={1.8} />
        </button>

        <div className="overflow-y-auto px-6 pb-5 pt-7">
          <div className="flex flex-col items-center text-center">
            <div className="flex items-center gap-3">
              <div className="flex size-[52px] items-center justify-center overflow-hidden rounded-2xl bg-background shadow-sm ring-1 ring-border/70">
                <img
                  alt=""
                  aria-hidden="true"
                  className="size-full object-contain"
                  src={pichuMark}
                />
              </div>
              <div className="flex items-center gap-1.5 text-border-strong">
                <span className="size-1.5 rounded-full bg-current opacity-50" />
                <span className="size-1.5 rounded-full bg-current opacity-35" />
                <span className="size-1.5 rounded-full bg-current opacity-25" />
              </div>
              <PluginIcon item={item} className="size-[52px] rounded-2xl" />
            </div>
            <h2
              id="plugin-install-title"
              className="mt-5 text-[22px] font-semibold tracking-tight text-foreground"
            >
              {t('plugins.installDialog.title', { name: item.title })}
            </h2>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              {t('plugins.installDialog.developer', { developer: developerName })}
            </p>
          </div>

          <div className="mt-6 rounded-2xl border border-border/70 bg-card/40 px-4 py-3.5">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground/5 text-muted-foreground">
                <ShieldCheck className="size-4" strokeWidth={1.8} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-foreground">
                  {hasAuth
                    ? t('plugins.installDialog.authTitle')
                    : t('plugins.installDialog.installTitle')}
                </div>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  {hasAuth
                    ? t('plugins.installDialog.authDescription')
                    : t('plugins.installDialog.installDescription')}
                </p>
              </div>
            </div>
            <div className="my-3 h-px bg-border/70" />
            <div className="text-[13px] font-semibold text-foreground">
              {t('plugins.installDialog.controlTitle')}
            </div>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              {t('plugins.installDialog.controlDescription')}
            </p>
            <div className="my-3 h-px bg-border/70" />
            <div className="text-[13px] font-semibold text-foreground">
              {t('plugins.installDialog.riskTitle')}
            </div>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              {t('plugins.installDialog.riskDescription')}
            </p>
          </div>
        </div>

        <div className="border-t border-border/70 bg-background px-6 py-4">
          <button
            type="button"
            disabled={busy}
            className="flex h-11 w-full items-center justify-center rounded-full bg-foreground px-5 text-[13px] font-semibold text-background transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
            onClick={onConfirm}
          >
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" strokeWidth={1.8} /> : null}
            {hasAuth
              ? t('plugins.installDialog.installAndAuthenticate', { name: item.title })
              : t('plugins.installDialog.install', { name: item.title })}
          </button>
        </div>
      </div>
    </div>
  )
}

function pluginDefaultPrompts(item: CatalogItem): string[] {
  const prompts = [
    ...(item.installed?.manifest.interface?.defaultPrompt ?? []),
    ...(item.available?.interface?.defaultPrompt ?? [])
  ]

  return [...new Set(prompts.map((prompt) => prompt.trim()).filter(Boolean))]
}

const pluginDetailExamples: Record<string, string[]> = {
  'computer-use': [
    'Pull key notes from the open spreadsheet',
    'Copy the approved talking points from the deck into the brief',
    'Check the open dashboard and list rows marked high priority'
  ],
  'in-app-browser-use': [
    'Open this page and summarize what changed',
    'Review the dashboard filters and summarize anomalies',
    'Fill this web form and verify the confirmation state'
  ],
  presentations: [
    'Turn these notes into an editable review deck',
    'Rework this partner update deck so the story is clearer',
    'Create a weekly metrics deck from this spreadsheet'
  ],
  youtube: [
    'Analyze recent MrBeast YouTube performance',
    'Compare these channels by recent views, engagement, and publish cadence',
    'Pull the latest videos for this niche and identify breakout topics'
  ],
  'youtube-cli': [
    'Analyze recent MrBeast YouTube performance',
    'Compare these channels by recent views, engagement, and publish cadence',
    'Pull the latest videos for this niche and identify breakout topics'
  ]
}

function detailScenariosForPlugin(item: CatalogItem): string[] {
  const examples = pluginDetailExamples[item.name]
  if (examples) return examples

  const defaultPrompts = pluginDefaultPrompts(item)
  if (defaultPrompts.length) return defaultPrompts

  return [
    `Use ${item.title} for this workflow`,
    `Inspect what ${item.title} can do in this repo`,
    `Help me finish this task with ${item.title}`
  ]
}

function pluginDetailShowcaseItems(item: CatalogItem): TypewriterShowcaseItem[] {
  return detailScenariosForPlugin(item).map((body, index) => ({
    id: `${item.key}-detail-${index}`,
    kind: 'plugin' as const,
    token: `@${item.name}`,
    label: item.title,
    body,
    iconSrc: item.logoSrc
  }))
}

function MarketplaceLoadingState(): React.JSX.Element {
  const { t } = useI18n()

  return (
    <div
      aria-live="polite"
      className="mt-16 flex min-h-[280px] flex-col items-center justify-center gap-3 text-center"
      role="status"
    >
      <Loader2 className="size-5 animate-spin text-muted-foreground" strokeWidth={1.8} />
      <p className="text-[14px] font-medium text-muted-foreground">
        {t('plugins.marketplaceLoading')}
      </p>
    </div>
  )
}

function ManageTabButton({
  active,
  count,
  label,
  onClick
}: {
  active: boolean
  count: number
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-xl px-3 text-[13px] transition',
        active
          ? 'bg-foreground/8 font-medium text-foreground'
          : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
      )}
      onClick={onClick}
    >
      <span>{label}</span>
      <span
        className={cn(
          'tabular-nums',
          active ? 'text-muted-foreground' : 'text-muted-foreground/80'
        )}
      >
        {count}
      </span>
    </button>
  )
}

function ManagePluginRow({
  item,
  busy,
  labels,
  onOpenDetails,
  onToggleEnabled,
  onUpdate,
  onReinstall,
  onUninstall
}: {
  item: CatalogItem
  busy: boolean
  labels: PluginActionLabels
  onOpenDetails: (item: CatalogItem) => void
  onToggleEnabled: (plugin: InstalledPlugin) => void
  onUpdate: (plugin: InstalledPlugin) => void
  onReinstall: (plugin: InstalledPlugin) => void
  onUninstall: (plugin: InstalledPlugin) => void
}): React.JSX.Element | null {
  const plugin = item.installed
  if (!plugin) return null

  return (
    <div className="group flex min-w-0 items-center gap-3 rounded-2xl px-3 py-2.5 transition hover:bg-foreground/4">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none"
        onClick={() => onOpenDetails(item)}
      >
        <PluginIcon item={item} className={plugin.enabled ? undefined : 'opacity-60 grayscale'} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-foreground">{item.title}</div>
          <div className="mt-0.5 line-clamp-1 text-[12px] text-muted-foreground">
            {item.description}
          </div>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-2">
        <PluginActionMenu
          item={item}
          busy={busy}
          labels={labels}
          onToggleEnabled={onToggleEnabled}
          onUpdate={onUpdate}
          onReinstall={onReinstall}
          onUninstall={onUninstall}
        />
        <Switch
          checked={plugin.enabled}
          disabled={busy}
          size="md"
          aria-label={plugin.enabled ? labels.disable : labels.enable}
          onCheckedChange={() => onToggleEnabled(plugin)}
        />
      </div>
    </div>
  )
}

function skillSourceLabel(skill: SkillSummary, t: (key: I18nKey) => string): string {
  if (skill.pluginName) return skill.pluginName
  if (skill.sourceKind === 'repo') return t('plugins.skillSource.project')
  if (skill.sourceKind === 'agents') return t('plugins.skillSource.personal')
  if (skill.sourceKind === 'claude') return t('plugins.skillSource.claude')
  if (skill.sourceKind === 'pichu' || skill.sourceKind === 'builtin') {
    return t('plugins.skillSource.pichu')
  }
  return skill.sourceLabel
}

function ManageSkillRow({
  skill,
  busy,
  enabled,
  canToggle,
  labels,
  onOpenFile,
  onOpenPreview,
  onToggleEnabled
}: {
  skill: SkillSummary
  busy: boolean
  enabled: boolean
  canToggle: boolean
  labels: Pick<PluginActionLabels, 'disable' | 'enable' | 'moreActions'>
  onOpenFile: (skill: SkillSummary) => void
  onOpenPreview: (skill: SkillSummary) => void
  onToggleEnabled: (skill: SkillSummary) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <div className="group flex min-w-0 items-center gap-3 rounded-2xl px-3 py-2.5 transition hover:bg-foreground/4">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none"
        onClick={() => onOpenPreview(skill)}
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card-muted/50 text-muted-foreground">
          <Package className="size-4" strokeWidth={1.7} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-foreground">{skill.name}</div>
          <div className="mt-0.5 line-clamp-1 text-[12px] text-muted-foreground">
            {skill.description}
          </div>
        </div>
        <div className="w-28 shrink-0 truncate text-right text-[12px] text-muted-foreground">
          {skillSourceLabel(skill, t)}
        </div>
      </button>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={busy}
            aria-label={labels.moreActions(skill.name)}
            className={cn(
              moreActionButtonClassName,
              'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100'
            )}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={1.8} />
            ) : (
              <MoreHorizontal className="size-3.5" strokeWidth={1.8} />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" className="w-32">
          <DropdownMenuItem className="px-3 py-2 text-[13px]" onSelect={() => onOpenFile(skill)}>
            {t('plugins.action.open')}
          </DropdownMenuItem>
          <DropdownMenuItem className="px-3 py-2 text-[13px]" onSelect={() => onOpenPreview(skill)}>
            {t('plugins.action.details')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Switch
        checked={enabled}
        disabled={busy || !canToggle}
        size="md"
        aria-label={enabled ? labels.disable : labels.enable}
        onCheckedChange={() => onToggleEnabled(skill)}
      />
    </div>
  )
}

function SkillPreviewDialog({
  preview,
  enabled,
  canToggle,
  busy,
  labels,
  onClose,
  onOpenFile,
  onToggleEnabled
}: {
  preview: SkillPreviewState
  enabled: boolean
  canToggle: boolean
  busy: boolean
  labels: Pick<PluginActionLabels, 'disable' | 'enable' | 'moreActions'>
  onClose: () => void
  onOpenFile: (skill: DisplaySkillSummary) => void
  onToggleEnabled: (skill: DisplaySkillSummary) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const markdown = preview.content ? previewMarkdown(preview.content) : ''

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (dialogRef.current?.contains(target)) return
      if (target.closest('[role="menu"]')) return
      onClose()
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-transparent px-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-preview-title"
        className="relative z-10 flex max-h-[82vh] w-full max-w-[640px] flex-col overflow-hidden rounded-3xl border border-border/70 bg-card shadow-2xl"
      >
        <button
          type="button"
          aria-label={t('plugins.skillPreview.close')}
          className="absolute right-5 top-5 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/10"
          onClick={onClose}
        >
          <X className="size-5" strokeWidth={1.8} />
        </button>

        <div className="px-6 pb-4 pt-8">
          <div className="flex items-center justify-between">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground">
              <Package className="size-[18px]" strokeWidth={1.7} />
            </div>
          </div>
          <div className="mt-7 flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <h2
                id="skill-preview-title"
                className="truncate text-[20px] font-semibold leading-7 text-foreground"
              >
                {preview.skill.name}{' '}
                <span className="font-normal text-muted-foreground">{t('plugins.skills')}</span>
              </h2>
              <p className="mt-1 line-clamp-3 text-[14px] leading-6 text-muted-foreground">
                {preview.skill.description}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Switch
                checked={enabled}
                disabled={busy || !canToggle}
                size="md"
                aria-label={enabled ? labels.disable : labels.enable}
                onCheckedChange={() => onToggleEnabled(preview.skill)}
              />
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={labels.moreActions(preview.skill.name)}
                    className={moreActionButtonClassName}
                  >
                    {busy ? (
                      <Loader2 className="size-3.5 animate-spin" strokeWidth={1.8} />
                    ) : (
                      <MoreHorizontal className="size-3.5" strokeWidth={1.8} />
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="bottom" className="w-40">
                  <DropdownMenuItem
                    className="px-3 py-2 text-[13px]"
                    onSelect={() => onOpenFile(preview.skill)}
                  >
                    {t('plugins.action.open')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 px-6 pb-5">
          <div className="max-h-[46vh] overflow-y-auto rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
            {preview.loading ? (
              <div className="flex min-h-[220px] items-center justify-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
                {t('plugins.skillPreview.loading')}
              </div>
            ) : preview.error ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                {preview.error}
              </div>
            ) : markdown ? (
              <MarkdownRenderer content={markdown} />
            ) : (
              <div className="py-8 text-center text-[13px] text-muted-foreground">
                {t('plugins.skillPreview.empty')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function PluginDetailView({
  item,
  skills,
  skillsLoaded,
  busy,
  labels,
  onBack,
  onInstall,
  onOpenSkillPreview,
  onToggleEnabled
}: {
  item: CatalogItem
  skills: SkillSummary[]
  skillsLoaded: boolean
  busy: boolean
  labels: PluginActionLabels
  onBack: () => void
  onInstall: (item: CatalogItem) => void
  onOpenSkillPreview: (skill: DisplaySkillSummary) => void
  onToggleEnabled: (plugin: InstalledPlugin) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const plugin = item.installed
  const pluginSkills: DisplaySkillSummary[] = plugin
    ? skills
        .filter((skill) => skill.pluginId === plugin.id)
        .sort((a, b) => a.name.localeCompare(b.name))
    : (item.available?.skills ?? []).sort((a, b) => a.name.localeCompare(b.name))
  const hasSkillComponent = Boolean(plugin?.manifest.skills || item.available?.skills?.length)
  const showSkillLoading = Boolean(plugin && hasSkillComponent && !skillsLoaded)
  const capabilities = pluginCapabilityLabels(item, t).join(', ')
  const developerName =
    item.available?.interface?.developerName ??
    item.installed?.manifest.interface?.developerName ??
    item.marketplaceName
  const showcaseItems = pluginDetailShowcaseItems(item)

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-10 flex items-center gap-2 text-[13px]">
        <button
          type="button"
          className="text-muted-foreground transition hover:text-foreground"
          onClick={onBack}
        >
          {t('nav.plugins')}
        </button>
        <ChevronDown className="size-3.5 -rotate-90 text-muted-foreground/70" />
        <span className="font-medium text-foreground">{item.title}</span>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <PluginIcon item={item} className="size-11 rounded-xl" />
          <div className="min-w-0">
            <h1 className="truncate text-[22px] font-semibold leading-8 text-foreground">
              {item.title}
            </h1>
            <p className="mt-0.5 text-[15px] leading-6 text-muted-foreground">{item.description}</p>
          </div>
        </div>
        {plugin ? (
          <Switch
            checked={plugin.enabled}
            disabled={busy}
            size="md"
            aria-label={plugin.enabled ? labels.disable : labels.enable}
            onCheckedChange={() => onToggleEnabled(plugin)}
          />
        ) : item.available ? (
          <button
            type="button"
            disabled={busy || item.available.policy?.installation === 'NOT_AVAILABLE'}
            className="h-8 shrink-0 rounded-xl bg-foreground px-3 text-[13px] font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              if (item.available) onInstall(item)
            }}
          >
            {labels.install}
          </button>
        ) : null}
      </div>

      <TypewriterShowcase items={showcaseItems} variant="stack" />

      <p className="mt-10 text-[14px] leading-6 text-foreground">
        {getPluginLongDescription(item)}
      </p>

      <div className="mt-10">
        <h2 className="text-[13px] font-semibold text-foreground">
          {t('plugins.detail.includes')}
        </h2>
        <div className="mt-3 overflow-hidden rounded-2xl border border-border/70 bg-card/70">
          {showSkillLoading ? (
            <div className="flex items-center gap-2 px-4 py-4 text-[13px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
              {t('plugins.skillPreview.loading')}
            </div>
          ) : pluginSkills.length > 0 ? (
            pluginSkills.map((skill) => (
              <button
                key={skill.qualifiedName ?? skill.filePath}
                type="button"
                disabled={!plugin}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-3 text-left transition focus-visible:outline-none',
                  plugin ? 'hover:bg-foreground/4' : 'cursor-default'
                )}
                onClick={() => {
                  if (plugin) onOpenSkillPreview(skill)
                }}
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border/70 text-muted-foreground">
                  <Package className="size-4" strokeWidth={1.7} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="truncate text-[13px] font-semibold text-foreground">
                      {skill.name}
                    </div>
                    <div className="shrink-0 text-[12px] text-muted-foreground">
                      {t('plugins.detail.kind.skill')}
                    </div>
                  </div>
                  <div className="mt-0.5 line-clamp-1 text-[12px] text-muted-foreground">
                    {skill.description}
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="px-4 py-5 text-[13px] text-muted-foreground">
              {t('plugins.detail.noSkills')}
            </div>
          )}
        </div>
      </div>

      <div className="mt-10">
        <h2 className="text-[13px] font-semibold text-foreground">
          {t('plugins.detail.information')}
        </h2>
        <div className="mt-3 overflow-hidden rounded-2xl border border-border/70 bg-card/70 text-[13px]">
          <div className="grid grid-cols-[160px_1fr] border-b border-border/70">
            <div className="px-4 py-3 text-muted-foreground">{t('plugins.detail.category')}</div>
            <div className="px-4 py-3 text-foreground">{item.category}</div>
          </div>
          <div className="grid grid-cols-[160px_1fr] border-b border-border/70">
            <div className="px-4 py-3 text-muted-foreground">
              {t('plugins.detail.capabilities')}
            </div>
            <div className="px-4 py-3 text-foreground">{capabilities}</div>
          </div>
          <div className="grid grid-cols-[160px_1fr] border-b border-border/70">
            <div className="px-4 py-3 text-muted-foreground">{t('plugins.detail.version')}</div>
            <div className="px-4 py-3 text-foreground">
              {plugin?.installedVersion ?? item.available?.version ?? '-'}
            </div>
          </div>
          <div className="grid grid-cols-[160px_1fr]">
            <div className="px-4 py-3 text-muted-foreground">{t('plugins.detail.developer')}</div>
            <div className="px-4 py-3 text-foreground">{developerName}</div>
          </div>
        </div>
      </div>
    </section>
  )
}

export function PluginsTab({ topBar }: { topBar?: ReactNode }): React.JSX.Element {
  const { t } = useI18n()
  const [mode, setMode] = useState<PluginsPageMode>('browse')
  const [manageTab, setManageTab] = useState<PluginManageTab>('plugins')
  const available = usePluginStore((state) => state.available)
  const installed = usePluginStore((state) => state.installed)
  const marketplaces = usePluginStore((state) => state.marketplaces)
  const marketplaceLoaded = usePluginStore((state) => state.marketplaceLoaded)
  const marketplaceRefreshing = usePluginStore((state) => state.marketplaceRefreshing)
  const marketplaceError = usePluginStore((state) => state.marketplaceError)
  const refreshPluginMarketplaces = usePluginStore((state) => state.refreshPluginMarketplaces)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [manageQuery, setManageQuery] = useState('')
  const [pluginDetailKey, setPluginDetailKey] = useState<string | null>(null)
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [skillsLoaded, setSkillsLoaded] = useState(false)
  const [skillsError, setSkillsError] = useState<string | null>(null)
  const [skillPreview, setSkillPreview] = useState<SkillPreviewState | null>(null)
  const [pendingInstallItem, setPendingInstallItem] = useState<CatalogItem | null>(null)
  const [installToast, setInstallToast] = useState<InstallToastState | null>(null)
  const [pluginStatusToast, setPluginStatusToast] = useState<PluginStatusToastState | null>(null)
  const skillPreviewRequestRef = useRef(0)
  const labels = useMemo<PluginActionLabels>(
    () => ({
      disable: t('plugins.action.disable'),
      disabled: t('plugins.state.disabled'),
      enable: t('plugins.action.enable'),
      install: t('plugins.action.install'),
      moreActions: (title) => t('plugins.action.moreActions', { title }),
      notAvailable: t('plugins.state.notAvailable'),
      update: t('plugins.action.update'),
      reinstall: t('plugins.action.reinstall'),
      updateAvailable: t('plugins.updateAvailable'),
      uninstall: t('plugins.action.uninstall')
    }),
    [t]
  )

  const installedByName = useMemo(
    () => new Map(installed.map((plugin) => [catalogKey(plugin.name), plugin])),
    [installed]
  )

  const installedById = useMemo(
    () => new Map(installed.map((plugin) => [plugin.id, plugin])),
    [installed]
  )

  const catalogItems = useMemo<CatalogItem[]>(() => {
    const items: CatalogItem[] = []
    const seen = new Set<string>()

    for (const entry of available) {
      seen.add(entry.name)
      const installedPlugin = installedByName.get(catalogKey(entry.name))
      const availableVersion = installedPlugin?.marketplaceStatus?.availableVersion
      const hasUpdate =
        installedPlugin &&
        compareVersionStrings(availableVersion, installedPlugin.installedVersion) > 0
      items.push({
        key: catalogKey(entry.name),
        name: entry.name,
        title: installedPlugin
          ? getInstalledTitle(installedPlugin)
          : (entry.interface?.displayName ?? entry.name),
        description: installedPlugin
          ? getInstalledDescription(installedPlugin)
          : getEntryDescription(entry),
        category: normalizePluginCategory(
          entry.name,
          installedPlugin?.manifest.interface?.category ?? entry.category
        ),
        marketplaceName: entry.marketplaceName,
        brandColor: installedPlugin?.manifest.interface?.brandColor ?? entry.interface?.brandColor,
        logoSrc:
          pluginLogoUrl(entry) ?? (installedPlugin ? pluginLogoUrl(installedPlugin) : undefined),
        installed: installedPlugin,
        available: entry,
        hasUpdate: Boolean(hasUpdate),
        hookCapability: installedPlugin ? hookCapabilitySummary(installedPlugin) : undefined,
        updateLabel:
          hasUpdate && availableVersion && installedPlugin
            ? t('plugins.updateVersion', {
                from: installedPlugin.installedVersion,
                to: availableVersion
              })
            : undefined
      })
    }

    for (const installedPlugin of installed) {
      const key = catalogKey(installedPlugin.name)
      if (seen.has(key)) continue
      items.push({
        key,
        name: installedPlugin.name,
        title: getInstalledTitle(installedPlugin),
        description: getInstalledDescription(installedPlugin),
        category: normalizePluginCategory(
          installedPlugin.name,
          installedPlugin.manifest.interface?.category ?? 'Installed'
        ),
        marketplaceName: installedPlugin.marketplaceName,
        brandColor: installedPlugin.manifest.interface?.brandColor,
        logoSrc: pluginLogoUrl(installedPlugin),
        installed: installedPlugin,
        hasUpdate: false,
        hookCapability: hookCapabilitySummary(installedPlugin)
      })
    }

    return items.sort((a, b) => {
      if (Boolean(a.installed) !== Boolean(b.installed)) return a.installed ? -1 : 1
      return a.title.localeCompare(b.title)
    })
  }, [available, installed, installedByName, t])

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return catalogItems.filter((item) => {
      const matchesSearch =
        normalizedQuery.length === 0 ||
        [item.title, item.name, item.description, item.marketplaceName, item.category]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery)
      return matchesSearch
    })
  }, [catalogItems, query])

  const managePluginItems = useMemo(
    () => catalogItems.filter((item) => item.installed),
    [catalogItems]
  )

  const pluginEnabledById = useMemo(
    () => new Map(installed.map((plugin) => [plugin.id, plugin.enabled])),
    [installed]
  )

  const filteredManagePluginItems = useMemo(() => {
    const normalizedQuery = manageQuery.trim().toLowerCase()
    if (!normalizedQuery) return managePluginItems
    return managePluginItems.filter((item) =>
      [item.title, item.name, item.description, item.marketplaceName, item.category]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery)
    )
  }, [managePluginItems, manageQuery])

  const filteredManageSkills = useMemo(() => {
    const normalizedQuery = manageQuery.trim().toLowerCase()
    const sortedSkills = [...skills].sort((a, b) => {
      const sourceOrder = skillSourceLabel(a, t).localeCompare(skillSourceLabel(b, t))
      if (sourceOrder !== 0) return sourceOrder
      return a.name.localeCompare(b.name)
    })
    if (!normalizedQuery) return sortedSkills
    return sortedSkills.filter((skill) =>
      [
        skill.name,
        skill.qualifiedName,
        skill.description,
        skill.sourceKind,
        skill.sourceLabel,
        skill.pluginName,
        skill.pluginVersion
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery)
    )
  }, [manageQuery, skills, t])

  const pluginDetailItem = useMemo(
    () => catalogItems.find((item) => item.key === pluginDetailKey) ?? null,
    [catalogItems, pluginDetailKey]
  )

  const enabledInstalledCount = useMemo(
    () => installed.filter((plugin) => plugin.enabled).length,
    [installed]
  )
  const marketplaceWarnings = useMemo(
    () => marketplaceWarningsFromRefresh(marketplaces),
    [marketplaces]
  )
  const hasMarketplaceCache = available.length > 0
  const showMarketplaceLoading =
    !hasMarketplaceCache && (!marketplaceLoaded || marketplaceRefreshing)
  const displayError = marketplaceRefreshing ? error : (error ?? marketplaceError)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      await refreshPluginMarketplaces('page_load')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [refreshPluginMarketplaces])

  const fetchSkills = useCallback(async () => {
    setSkillsError(null)
    try {
      const result = await window.api.agent.listSkills()
      setSkills(result.skills)
      setSkillsLoaded(true)
    } catch (err) {
      setSkillsError(err instanceof Error ? err.message : String(err))
      setSkillsLoaded(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (mode !== 'manage' && mode !== 'pluginDetail') return
    void fetchSkills()
  }, [fetchSkills, mode])

  useEffect(() => {
    if (!installToast) return
    const timeout = window.setTimeout(() => setInstallToast(null), 3600)
    return () => window.clearTimeout(timeout)
  }, [installToast])

  useEffect(() => {
    if (!pluginStatusToast) return
    const timeout = window.setTimeout(() => setPluginStatusToast(null), 3600)
    return () => window.clearTimeout(timeout)
  }, [pluginStatusToast])

  const confirmInstall = useCallback(async () => {
    const entry = pendingInstallItem?.available
    if (!entry) return
    const key = catalogKey(entry.name)
    setBusyKey(key)
    setError(null)
    try {
      const plugin = await window.api.plugins.install({
        marketplaceName: entry.marketplaceName,
        pluginName: entry.name
      })
      const authFailureMessage = pluginInstallAuthFailureDiagnostic(plugin)
      setPendingInstallItem(null)
      await refresh()
      if (authFailureMessage) {
        setInstallToast({
          id: Date.now(),
          title: t('plugins.installDialog.authWarningTitle'),
          description: authFailureMessage,
          variant: 'info'
        })
      }
    } catch (err) {
      const message = errorMessage(err)
      if (isPluginAuthInstallError(err)) {
        setPendingInstallItem(null)
        setInstallToast({
          id: Date.now(),
          title: t('plugins.installDialog.authFailed'),
          description: message,
          variant: 'error'
        })
      } else {
        setError(message)
      }
    } finally {
      setBusyKey(null)
    }
  }, [pendingInstallItem, refresh, t])

  const openSkillPreview = useCallback(async (skill: DisplaySkillSummary) => {
    const requestId = skillPreviewRequestRef.current + 1
    skillPreviewRequestRef.current = requestId
    setSkillPreview({
      skill,
      content: null,
      loading: true,
      error: null
    })
    try {
      const result = await window.api.agent.readSkill(skill.filePath)
      setSkillPreview((currentPreview) => {
        if (
          !currentPreview ||
          currentPreview.skill.filePath !== skill.filePath ||
          skillPreviewRequestRef.current !== requestId
        ) {
          return currentPreview
        }
        return {
          skill,
          content: result.content,
          loading: false,
          error: null
        }
      })
    } catch (err) {
      setSkillPreview((currentPreview) => {
        if (
          !currentPreview ||
          currentPreview.skill.filePath !== skill.filePath ||
          skillPreviewRequestRef.current !== requestId
        ) {
          return currentPreview
        }
        return {
          skill,
          content: null,
          loading: false,
          error: err instanceof Error ? err.message : String(err)
        }
      })
    }
  }, [])

  const openSkillFile = useCallback(async (skill: DisplaySkillSummary) => {
    setSkillsError(null)
    try {
      await window.api.agent.openSkill(skill.filePath)
    } catch (err) {
      setSkillsError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const openPluginDetail = useCallback((item: CatalogItem) => {
    setPluginDetailKey(item.key)
    setMode('pluginDetail')
  }, [])

  const handleTogglePlugin = useCallback(
    async (plugin: InstalledPlugin) => {
      const nextEnabled = !plugin.enabled
      setBusyKey(plugin.id)
      setError(null)
      try {
        if (plugin.enabled) {
          await window.api.plugins.disable(plugin.id)
        } else {
          await window.api.plugins.enable(plugin.id)
        }
        await refresh()
        if (mode === 'manage') {
          await fetchSkills()
        }
        setPluginStatusToast({
          id: Date.now(),
          title: t(nextEnabled ? 'plugins.toast.enabled' : 'plugins.toast.disabled', {
            name: getInstalledTitle(plugin)
          })
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusyKey(null)
      }
    },
    [fetchSkills, mode, refresh, t]
  )

  const handleToggleSkillSource = useCallback(
    async (skill: SkillSummary) => {
      if (!skill.pluginId) return

      setBusyKey(skill.pluginId)
      setSkillsError(null)
      try {
        const plugin = installedById.get(skill.pluginId)
        const pluginName = plugin ? getInstalledTitle(plugin) : (skill.pluginName ?? skill.name)
        const nextEnabled = pluginEnabledById.get(skill.pluginId) === false

        if (nextEnabled) {
          await window.api.plugins.enable(skill.pluginId)
        } else {
          await window.api.plugins.disable(skill.pluginId)
        }
        await refresh()
        await fetchSkills()
        setPluginStatusToast({
          id: Date.now(),
          title: t(nextEnabled ? 'plugins.toast.enabled' : 'plugins.toast.disabled', {
            name: pluginName
          })
        })
      } catch (err) {
        setSkillsError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusyKey(null)
      }
    },
    [fetchSkills, installedById, pluginEnabledById, refresh, t]
  )

  const handleUpdatePlugin = useCallback(
    async (plugin: InstalledPlugin) => {
      setBusyKey(plugin.id)
      setError(null)
      try {
        await window.api.plugins.upgrade(plugin.id)
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusyKey(null)
      }
    },
    [refresh]
  )

  const handleReinstallPlugin = useCallback(
    async (plugin: InstalledPlugin) => {
      setBusyKey(plugin.id)
      setError(null)
      try {
        await window.api.plugins.reinstall(plugin.id)
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusyKey(null)
      }
    },
    [refresh]
  )

  const handleUninstallPlugin = useCallback(
    async (plugin: InstalledPlugin) => {
      if (!window.confirm(t('plugins.uninstallConfirm', { name: getInstalledTitle(plugin) }))) {
        return
      }

      setBusyKey(plugin.id)
      setError(null)
      try {
        await window.api.plugins.uninstall(plugin.id)
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusyKey(null)
      }
    },
    [refresh, t]
  )

  return (
    <div className="pb-10">
      {mode === 'pluginDetail' && pluginDetailItem ? (
        <PluginDetailView
          item={pluginDetailItem}
          skills={skills}
          skillsLoaded={skillsLoaded}
          busy={pluginDetailItem.installed ? busyKey === pluginDetailItem.installed.id : false}
          labels={labels}
          onBack={() => setMode('browse')}
          onInstall={(nextItem) => setPendingInstallItem(nextItem)}
          onOpenSkillPreview={(skill) => void openSkillPreview(skill)}
          onToggleEnabled={(plugin) => void handleTogglePlugin(plugin)}
        />
      ) : mode === 'manage' ? (
        <section className="mx-auto max-w-3xl">
          <div className="mb-10 flex items-center gap-2 text-[13px]">
            <button
              type="button"
              className="text-muted-foreground transition hover:text-foreground"
              onClick={() => setMode('browse')}
            >
              {t('nav.plugins')}
            </button>
            <ChevronDown className="size-3.5 -rotate-90 text-muted-foreground/70" />
            <span className="font-medium text-foreground">{t('plugins.manage')}</span>
          </div>

          <div className="mb-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <ManageTabButton
                active={manageTab === 'plugins'}
                count={managePluginItems.length}
                label={t('nav.plugins')}
                onClick={() => setManageTab('plugins')}
              />
              <ManageTabButton
                active={manageTab === 'skills'}
                count={skills.length}
                label={t('plugins.skills')}
                onClick={() => setManageTab('skills')}
              />
            </div>
            <div className="relative w-full max-w-[240px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
              <input
                value={manageQuery}
                onChange={(event) => setManageQuery(event.target.value)}
                placeholder={
                  manageTab === 'plugins' ? t('plugins.search') : t('plugins.searchSkills')
                }
                className="h-9 w-full rounded-xl border border-border/70 bg-card px-8 text-[13px] outline-none transition placeholder:text-muted-foreground/60 focus:border-border-strong focus:ring-2 focus:ring-foreground/5"
              />
            </div>
          </div>

          {manageTab === 'plugins' ? (
            filteredManagePluginItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-card-muted/40 px-4 py-8 text-center text-[13px] text-muted-foreground">
                {manageQuery.trim() ? t('plugins.emptyFilters') : t('plugins.emptyInstalled')}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredManagePluginItems.map((item) => (
                  <ManagePluginRow
                    key={item.key}
                    item={item}
                    busy={item.installed ? busyKey === item.installed.id : false}
                    labels={labels}
                    onOpenDetails={openPluginDetail}
                    onToggleEnabled={(plugin) => void handleTogglePlugin(plugin)}
                    onUpdate={(plugin) => void handleUpdatePlugin(plugin)}
                    onReinstall={(plugin) => void handleReinstallPlugin(plugin)}
                    onUninstall={(plugin) => void handleUninstallPlugin(plugin)}
                  />
                ))}
              </div>
            )
          ) : skillsError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              {skillsError}
            </div>
          ) : !skillsLoaded ? (
            <MarketplaceLoadingState />
          ) : filteredManageSkills.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-card-muted/40 px-4 py-8 text-center text-[13px] text-muted-foreground">
              {manageQuery.trim() ? t('plugins.emptySkillFilters') : t('plugins.emptySkills')}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredManageSkills.map((skill) => {
                const canToggle = Boolean(skill.pluginId)
                const enabled = skill.pluginId
                  ? pluginEnabledById.get(skill.pluginId) !== false
                  : true
                return (
                  <ManageSkillRow
                    key={skill.qualifiedName ?? skill.filePath}
                    skill={skill}
                    busy={skill.pluginId ? busyKey === skill.pluginId : false}
                    enabled={enabled}
                    canToggle={canToggle}
                    labels={labels}
                    onOpenFile={(nextSkill) => void openSkillFile(nextSkill)}
                    onOpenPreview={(nextSkill) => void openSkillPreview(nextSkill)}
                    onToggleEnabled={(nextSkill) => void handleToggleSkillSource(nextSkill)}
                  />
                )
              })}
            </div>
          )}
        </section>
      ) : (
        <>
          <div className="mb-2 flex min-h-8 items-center justify-between gap-4">
            {topBar ? <div className="min-w-0">{topBar}</div> : <div />}
            <button
              type="button"
              className="flex h-8 items-center gap-1.5 rounded-xl bg-foreground/8 px-3 text-[13px] font-medium text-foreground transition hover:bg-foreground/12"
              onClick={() => setMode('manage')}
            >
              <Settings2 className="size-3.5" strokeWidth={1.8} />
              {t('plugins.manage')}
            </button>
          </div>

          <section className="mx-auto max-w-3xl">
            <div className="text-center">
              <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
                {t('plugins.heroTitle')}
              </h1>
            </div>

            {showMarketplaceLoading ? (
              <MarketplaceLoadingState />
            ) : (
              <>
                <div className="mt-6">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={t('plugins.search')}
                      className="h-9 w-full rounded-xl border border-border/70 bg-card px-8 text-[13px] outline-none transition placeholder:text-muted-foreground/60 focus:border-border-strong focus:ring-2 focus:ring-foreground/5"
                    />
                  </div>
                </div>

                {displayError ? (
                  <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                    {displayError}
                  </div>
                ) : null}

                {!displayError && marketplaceWarnings.length > 0 ? (
                  <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-900 dark:text-amber-100">
                    <p className="font-medium">{t('plugins.marketplaceWarning.title')}</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                      {marketplaceWarnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="mt-5 flex items-center justify-between border-b border-border/70 pb-3">
                  <h2 className="text-[13px] font-semibold text-foreground">
                    {t('plugins.featured')}
                  </h2>
                  <div className="text-[12px] text-muted-foreground">
                    {t('plugins.installSummary', {
                      enabled: enabledInstalledCount,
                      installed: installed.length,
                      available: available.length
                    })}
                  </div>
                </div>

                {filteredItems.length === 0 ? (
                  <div className="mt-3 rounded-2xl border border-dashed border-border/70 bg-card-muted/40 px-4 py-8 text-center text-[13px] text-muted-foreground">
                    {t('plugins.emptyFilters')}
                  </div>
                ) : (
                  <div className="mt-4 grid grid-cols-1 gap-x-5 gap-y-1 md:grid-cols-2">
                    {filteredItems.map((item) => (
                      <CatalogCard
                        key={item.key}
                        item={item}
                        busy={
                          item.installed
                            ? busyKey === item.installed.id
                            : item.available
                              ? busyKey === catalogKey(item.available.name)
                              : false
                        }
                        onInstall={() => setPendingInstallItem(item)}
                        onOpenDetails={openPluginDetail}
                        onToggleEnabled={(plugin) => void handleTogglePlugin(plugin)}
                        onUpdate={(plugin) => void handleUpdatePlugin(plugin)}
                        onReinstall={(plugin) => void handleReinstallPlugin(plugin)}
                        onUninstall={(plugin) => void handleUninstallPlugin(plugin)}
                        labels={labels}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
      {skillPreview ? (
        <SkillPreviewDialog
          preview={skillPreview}
          enabled={
            skillPreview.skill.pluginId
              ? pluginEnabledById.get(skillPreview.skill.pluginId) !== false
              : true
          }
          canToggle={Boolean(skillPreview.skill.pluginId)}
          busy={skillPreview.skill.pluginId ? busyKey === skillPreview.skill.pluginId : false}
          labels={labels}
          onClose={() => setSkillPreview(null)}
          onOpenFile={(nextSkill) => void openSkillFile(nextSkill)}
          onToggleEnabled={(nextSkill) => void handleToggleSkillSource(nextSkill)}
        />
      ) : null}
      {pendingInstallItem ? (
        <PluginInstallDialog
          item={pendingInstallItem}
          busy={
            pendingInstallItem.available
              ? busyKey === catalogKey(pendingInstallItem.available.name)
              : false
          }
          onClose={() => {
            if (!busyKey) {
              setPendingInstallItem(null)
            }
          }}
          onConfirm={() => void confirmInstall()}
        />
      ) : null}
      <ToastViewport>
        {pluginStatusToast ? (
          <Toast
            key={pluginStatusToast.id}
            title={pluginStatusToast.title}
            variant="success"
            onClose={() => setPluginStatusToast(null)}
            closeLabel={t('plugins.toast.dismiss')}
          />
        ) : null}
        {installToast ? (
          <Toast
            key={installToast.id}
            title={installToast.title}
            description={installToast.description}
            variant={installToast.variant}
            onClose={() => setInstallToast(null)}
            closeLabel={t('plugins.installDialog.dismissAuthFailed')}
          />
        ) : null}
      </ToastViewport>
    </div>
  )
}
