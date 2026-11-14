import { Switch } from '@renderer/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useI18n } from '@renderer/lib/i18n'
import { Cable, CheckCircle2, Pencil, Plus, ShieldCheck, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type {
  CustomMcpServerSummary,
  SaveCustomMcpServerInput
} from '../../../../shared/custom-mcp'
import { McpIcon } from './McpIcon'
import { SettingsDialog, SettingsDialogCancel } from './SettingsDialog'
import {
  SettingsButton,
  SettingsCard,
  SettingsSection,
  SettingsSegmentedControl,
  SettingsTextInput
} from './settings-ui'

type KeyValueRow = { id: string; key: string; value: string }

type McpServerDraft = {
  id?: string
  name: string
  type: 'stdio' | 'streamable-http'
  command: string
  args: string
  cwd: string
  env: KeyValueRow[]
  url: string
  headers: KeyValueRow[]
}

const EMPTY_DRAFT: McpServerDraft = {
  name: '',
  type: 'stdio',
  command: '',
  args: '',
  cwd: '',
  env: [],
  url: '',
  headers: []
}

function rowsFromRecord(record: Record<string, string>): KeyValueRow[] {
  return Object.entries(record).map(([key, value]) => ({ id: crypto.randomUUID(), key, value }))
}

function recordFromRows(rows: KeyValueRow[]): Record<string, string> {
  return Object.fromEntries(
    rows.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value])
  )
}

function draftFromServer(server: CustomMcpServerSummary): McpServerDraft {
  if (server.type === 'stdio') {
    return {
      ...EMPTY_DRAFT,
      id: server.id,
      name: server.name,
      type: 'stdio',
      command: server.command,
      args: server.args.join('\n'),
      cwd: server.cwd,
      env: rowsFromRecord(server.env)
    }
  }
  return {
    ...EMPTY_DRAFT,
    id: server.id,
    name: server.name,
    type: 'streamable-http',
    url: server.url,
    headers: rowsFromRecord(server.headers)
  }
}

function inputFromDraft(draft: McpServerDraft, enabled = true): SaveCustomMcpServerInput {
  if (draft.type === 'stdio') {
    return {
      id: draft.id,
      name: draft.name,
      enabled,
      type: 'stdio',
      command: draft.command,
      args: draft.args
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean),
      cwd: draft.cwd,
      env: recordFromRows(draft.env)
    }
  }
  return {
    id: draft.id,
    name: draft.name,
    enabled,
    type: 'streamable-http',
    url: draft.url,
    headers: recordFromRows(draft.headers)
  }
}

function inputFromServer(server: CustomMcpServerSummary): SaveCustomMcpServerInput {
  const { oauthConnected: _, ...input } = server
  return input
}

function KeyValueEditor({
  rows,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
  removeLabel,
  onChange
}: {
  rows: KeyValueRow[]
  keyPlaceholder: string
  valuePlaceholder: string
  addLabel: string
  removeLabel: string
  onChange: (rows: KeyValueRow[]) => void
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div className="flex gap-2" key={row.id}>
          <SettingsTextInput
            className="min-w-0 flex-1 font-mono"
            aria-label={keyPlaceholder}
            placeholder={keyPlaceholder}
            value={row.key}
            onChange={(event) => {
              const next = [...rows]
              next[index] = { ...row, key: event.target.value }
              onChange(next)
            }}
          />
          <SettingsTextInput
            className="min-w-0 flex-1 font-mono"
            aria-label={valuePlaceholder}
            placeholder={valuePlaceholder}
            value={row.value}
            onChange={(event) => {
              const next = [...rows]
              next[index] = { ...row, value: event.target.value }
              onChange(next)
            }}
          />
          <SettingsButton
            className="px-2"
            aria-label={removeLabel}
            onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
          >
            <X className="size-3.5" />
          </SettingsButton>
        </div>
      ))}
      <SettingsButton
        onClick={() => onChange([...rows, { id: crypto.randomUUID(), key: '', value: '' }])}
      >
        <Plus className="size-3.5" />
        {addLabel}
      </SettingsButton>
    </div>
  )
}

export function CustomizeTab(): React.JSX.Element {
  const { t } = useI18n()
  const [servers, setServers] = useState<CustomMcpServerSummary[]>([])
  const [draft, setDraft] = useState<McpServerDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [connectionBusyId, setConnectionBusyId] = useState<string | null>(null)
  const [verifiedRemoteIds, setVerifiedRemoteIds] = useState<Set<string>>(() => new Set())

  const load = useCallback((): void => {
    void window.api.customMcp
      .list()
      .then(setServers)
      .catch((value) => setError(value instanceof Error ? value.message : String(value)))
  }, [])

  useEffect(() => load(), [load])

  const save = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      setServers(await window.api.customMcp.save(inputFromDraft(draft)))
      setDraft(null)
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (server: CustomMcpServerSummary): Promise<void> => {
    setError(null)
    try {
      setServers(
        await window.api.customMcp.save({ ...inputFromServer(server), enabled: !server.enabled })
      )
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    }
  }

  const remove = async (server: CustomMcpServerSummary): Promise<void> => {
    if (!window.confirm(t('customize.mcp.deleteConfirm', { name: server.name }))) return
    setError(null)
    try {
      setServers(await window.api.customMcp.delete(server.id))
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    }
  }

  const toggleRemoteConnection = async (server: CustomMcpServerSummary): Promise<void> => {
    setConnectionBusyId(server.id)
    setError(null)
    try {
      let nextServers: CustomMcpServerSummary[]
      if (server.oauthConnected) {
        nextServers = await window.api.customMcp.disconnect(server.id)
      } else {
        const result = await window.api.customMcp.connect(server.id)
        if (!result.ok) {
          setError(t('customize.mcp.error.oauthDiscoveryInvalid'))
          return
        }
        nextServers = result.servers
      }
      setServers(nextServers)
      setVerifiedRemoteIds((current) => {
        const next = new Set(current)
        if (server.oauthConnected) {
          next.delete(server.id)
        } else if (!nextServers.find((entry) => entry.id === server.id)?.oauthConnected) {
          next.add(server.id)
        }
        return next
      })
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    } finally {
      setConnectionBusyId(null)
    }
  }

  const remoteConnectionLabel = (server: CustomMcpServerSummary): string => {
    if (connectionBusyId === server.id) return t('customize.mcp.oauth.waiting')
    if (server.oauthConnected) return t('customize.mcp.oauth.disconnect')
    if (verifiedRemoteIds.has(server.id)) return t('customize.mcp.connection.verified')
    return t('customize.mcp.connection.connect')
  }

  return (
    <SettingsSection
      title={t('customize.mcp.title')}
      description={t('customize.mcp.description')}
      action={
        <SettingsButton variant="primary" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
          <McpIcon className="size-4" />
          {t('customize.mcp.add')}
        </SettingsButton>
      }
    >
      <SettingsCard>
        {servers.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center px-8 text-center">
            <span className="mb-3 grid size-9 place-items-center rounded-xl bg-foreground/5 text-muted-foreground">
              <McpIcon className="size-5" />
            </span>
            <p className="text-[13px] font-medium text-foreground">
              {t('customize.mcp.empty.title')}
            </p>
            <p className="mt-1 max-w-sm text-[12.5px] leading-5 text-muted-foreground">
              {t('customize.mcp.empty.description')}
            </p>
          </div>
        ) : (
          servers.map((server) => (
            <div
              key={server.id}
              className="flex min-h-[82px] items-center gap-3.5 border-b border-border/55 px-3.5 py-3 last:border-b-0"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-foreground/5 text-foreground/80">
                <McpIcon className="size-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-foreground">
                    {server.name}
                  </span>
                  <span className="rounded-md bg-foreground/5 px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                    {server.type === 'stdio' ? 'stdio' : t('customize.mcp.remote')}
                  </span>
                </div>
                <p className="mt-1 truncate font-mono text-[11.5px] text-muted-foreground">
                  {server.type === 'stdio'
                    ? [server.command, ...server.args].join(' ')
                    : server.url}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Switch
                  size="sm"
                  checked={server.enabled}
                  aria-label={t('customize.mcp.enabled', { name: server.name })}
                  onCheckedChange={() => void toggle(server)}
                />
                {server.type === 'streamable-http' ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <SettingsButton
                        className="border border-border/80 bg-background px-2 shadow-sm hover:border-border-strong hover:bg-foreground/5"
                        aria-label={remoteConnectionLabel(server)}
                        disabled={connectionBusyId === server.id}
                        onClick={() => void toggleRemoteConnection(server)}
                      >
                        {server.oauthConnected || verifiedRemoteIds.has(server.id) ? (
                          <CheckCircle2 className="size-3.5 text-emerald-600" />
                        ) : (
                          <Cable className="size-3.5" />
                        )}
                      </SettingsButton>
                    </TooltipTrigger>
                    <TooltipContent side="top">{remoteConnectionLabel(server)}</TooltipContent>
                  </Tooltip>
                ) : null}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SettingsButton
                      className="px-2"
                      aria-label={t('customize.mcp.edit')}
                      onClick={() => setDraft(draftFromServer(server))}
                    >
                      <Pencil className="size-3.5" />
                    </SettingsButton>
                  </TooltipTrigger>
                  <TooltipContent side="top">{t('customize.mcp.edit')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SettingsButton
                      className="px-2"
                      variant="danger"
                      aria-label={t('customize.mcp.delete')}
                      onClick={() => void remove(server)}
                    >
                      <Trash2 className="size-3.5" />
                    </SettingsButton>
                  </TooltipTrigger>
                  <TooltipContent side="top">{t('customize.mcp.delete')}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          ))
        )}
      </SettingsCard>

      {error && !draft ? <p className="mt-3 text-[12.5px] text-destructive">{error}</p> : null}

      {draft ? (
        <SettingsDialog
          title={
            draft.id ? t('customize.mcp.dialog.editTitle') : t('customize.mcp.dialog.addTitle')
          }
          description={t('customize.mcp.dialog.description')}
          closeLabel={t('customize.mcp.cancel')}
          onClose={() => setDraft(null)}
          actions={
            <>
              <SettingsDialogCancel onClick={() => setDraft(null)}>
                {t('customize.mcp.cancel')}
              </SettingsDialogCancel>
              <SettingsButton variant="primary" disabled={saving} onClick={() => void save()}>
                {saving ? t('customize.mcp.saving') : t('customize.mcp.save')}
              </SettingsButton>
            </>
          }
        >
          <div className="space-y-4">
            <label htmlFor="mcp-name" className="block text-[12.5px] text-muted-foreground">
              {t('customize.mcp.name')}
              <SettingsTextInput
                id="mcp-name"
                className="mt-1 w-full"
                autoFocus
                value={draft.name}
                placeholder={t('customize.mcp.namePlaceholder')}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>

            <div>
              <span className="mb-1.5 block text-[12.5px] text-muted-foreground">
                {t('customize.mcp.transport')}
              </span>
              <SettingsSegmentedControl
                value={draft.type}
                onChange={(type) => setDraft({ ...draft, type })}
                options={[
                  { value: 'stdio', label: 'stdio' },
                  { value: 'streamable-http', label: t('customize.mcp.remote') }
                ]}
              />
            </div>

            {draft.type === 'stdio' ? (
              <>
                <label htmlFor="mcp-command" className="block text-[12.5px] text-muted-foreground">
                  {t('customize.mcp.command')}
                  <SettingsTextInput
                    id="mcp-command"
                    className="mt-1 w-full font-mono"
                    placeholder="npx"
                    value={draft.command}
                    onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                  />
                </label>
                <label htmlFor="mcp-args" className="block text-[12.5px] text-muted-foreground">
                  {t('customize.mcp.args')}
                  <textarea
                    id="mcp-args"
                    className="mt-1 min-h-24 w-full resize-y rounded-lg border border-border/70 bg-background px-3 py-2 font-mono text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/55 focus:border-border-strong focus:ring-2 focus:ring-foreground/8"
                    placeholder={'-y\n@modelcontextprotocol/server-filesystem'}
                    value={draft.args}
                    onChange={(event) => setDraft({ ...draft, args: event.target.value })}
                  />
                  <span className="mt-1 block text-[11.5px] leading-4 text-muted-foreground/80">
                    {t('customize.mcp.argsHint')}
                  </span>
                </label>
                <label htmlFor="mcp-cwd" className="block text-[12.5px] text-muted-foreground">
                  {t('customize.mcp.cwd')}
                  <SettingsTextInput
                    id="mcp-cwd"
                    className="mt-1 w-full font-mono"
                    placeholder={t('customize.mcp.cwdPlaceholder')}
                    value={draft.cwd}
                    onChange={(event) => setDraft({ ...draft, cwd: event.target.value })}
                  />
                </label>
                <div>
                  <span className="mb-1.5 block text-[12.5px] text-muted-foreground">
                    {t('customize.mcp.env')}
                  </span>
                  <KeyValueEditor
                    rows={draft.env}
                    keyPlaceholder={t('customize.mcp.key')}
                    valuePlaceholder={t('customize.mcp.value')}
                    addLabel={t('customize.mcp.addVariable')}
                    removeLabel={t('customize.mcp.removeVariable')}
                    onChange={(env) => setDraft({ ...draft, env })}
                  />
                </div>
              </>
            ) : (
              <>
                <label htmlFor="mcp-url" className="block text-[12.5px] text-muted-foreground">
                  {t('customize.mcp.url')}
                  <SettingsTextInput
                    id="mcp-url"
                    className="mt-1 w-full font-mono"
                    placeholder="https://example.com/mcp"
                    value={draft.url}
                    onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                  />
                </label>
                <div className="flex gap-2.5 rounded-lg bg-foreground/4 px-3 py-2.5 text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                  <p className="text-[11.5px] leading-4">{t('customize.mcp.remoteAuthHint')}</p>
                </div>
                <div>
                  <span className="mb-1.5 block text-[12.5px] text-muted-foreground">
                    {t('customize.mcp.headers')}
                  </span>
                  <KeyValueEditor
                    rows={draft.headers}
                    keyPlaceholder={t('customize.mcp.header')}
                    valuePlaceholder={t('customize.mcp.value')}
                    addLabel={t('customize.mcp.addHeader')}
                    removeLabel={t('customize.mcp.removeHeader')}
                    onChange={(headers) => setDraft({ ...draft, headers })}
                  />
                </div>
              </>
            )}

            {error ? <p className="text-[12.5px] text-destructive">{error}</p> : null}
          </div>
        </SettingsDialog>
      ) : null}
    </SettingsSection>
  )
}
