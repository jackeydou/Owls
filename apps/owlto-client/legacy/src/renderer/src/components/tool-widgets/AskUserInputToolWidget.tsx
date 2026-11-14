import { useI18n } from '@renderer/lib/i18n'
import { Check, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ToolWidgetComponentProps } from './types'

type HumanInputWidgetValue = string | string[] | boolean

const fieldClassName =
  'w-full rounded-lg border border-transparent bg-card-muted/70 px-3 py-2.5 text-[14px] leading-5 text-foreground outline-none transition placeholder:text-muted-foreground/65 focus:border-border focus:bg-background focus:ring-2 focus:ring-ring/10 disabled:opacity-60'

const primaryButtonClassName =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-foreground transition hover:bg-card-muted disabled:opacity-45'

const secondaryButtonClassName =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-muted-foreground/65 transition hover:bg-card-muted hover:text-muted-foreground disabled:opacity-45'

function HumanInputSkeleton(): React.JSX.Element {
  return (
    <div className="w-full max-w-xl rounded-lg border border-border/60 bg-background px-4 py-3 shadow-[0_1px_2px_rgb(0_0_0_/_0.03)]">
      <div className="space-y-2">
        <div className="h-4 w-36 animate-pulse rounded bg-card-muted" />
        <div className="h-3 w-64 max-w-full animate-pulse rounded bg-card-muted/75" />
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-10 animate-pulse rounded-lg bg-card-muted/70" />
        <div className="h-10 animate-pulse rounded-lg bg-card-muted/55" />
      </div>
    </div>
  )
}

function submittedLabel(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every((item) => typeof item === 'string'))
    return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Confirmed' : 'Cancelled'
  return ''
}

export function AskUserInputToolWidget({ widget }: ToolWidgetComponentProps): React.JSX.Element {
  const { t } = useI18n()
  const request = widget.humanInput
  const initialValue = useMemo(() => {
    if (!request) return ''
    if (typeof request.defaultValue === 'string') return request.defaultValue
    if (
      request.input.type === 'select' &&
      request.input.multiple === true &&
      Array.isArray(request.defaultValue) &&
      request.defaultValue.every((item) => typeof item === 'string')
    ) {
      return request.defaultValue
    }
    return ''
  }, [request])
  const initialCustomValue = useMemo(() => {
    if (request?.input.type !== 'select') return ''
    const optionValues = new Set(request.input.options.map((option) => option.value))
    if (request.input.multiple === true) {
      if (
        Array.isArray(request.defaultValue) &&
        request.defaultValue.every((item) => typeof item === 'string')
      ) {
        return request.defaultValue.filter((item) => !optionValues.has(item)).join(', ')
      }
      return ''
    }
    return typeof request.defaultValue === 'string' && !optionValues.has(request.defaultValue)
      ? request.defaultValue
      : ''
  }, [request])
  const [value, setValue] = useState<HumanInputWidgetValue>(initialValue)
  const [customValue, setCustomValue] = useState(initialCustomValue)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!request) {
    return <HumanInputSkeleton />
  }

  const response = request.response
  const readOnly =
    request.status === 'submitted' ||
    request.status === 'cancelled' ||
    request.status === 'resolved' ||
    request.status === 'expired'
  const selectInput = request.input.type === 'select' ? request.input : null

  async function submit(nextValue: HumanInputWidgetValue): Promise<void> {
    if (!request || submitting) return
    if (
      request.input.type === 'text' &&
      request.input.required &&
      (typeof nextValue !== 'string' || !nextValue.trim())
    ) {
      setError(t('chat.humanInput.required'))
      return
    }
    if (
      request.input.type === 'select' &&
      (request.input.multiple === true
        ? !Array.isArray(nextValue) || nextValue.length === 0
        : typeof nextValue !== 'string' || !nextValue.trim())
    ) {
      setError(t('chat.humanInput.required'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await window.api.agent.submitHumanInput({
        requestId: request.id,
        value: nextValue
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  function toggleSelectValue(optionValue: string): void {
    if (!request || request.input.type !== 'select') return
    if (request.input.multiple !== true) {
      setValue(optionValue)
      setCustomValue('')
      return
    }
    setValue((current) => {
      const selected = Array.isArray(current) ? current : []
      return selected.includes(optionValue)
        ? selected.filter((item) => item !== optionValue)
        : [...selected, optionValue]
    })
  }

  function selectValueForSubmit(): string | string[] {
    const custom = customValue.trim()
    if (request?.input.type === 'select' && request.input.multiple === true) {
      const selected = Array.isArray(value) ? value : []
      return custom ? [...selected, custom] : selected
    }
    return custom || (typeof value === 'string' ? value : '')
  }

  async function cancel(): Promise<void> {
    if (!request || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await window.api.agent.cancelHumanInput({ requestId: request.id })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full max-w-xl rounded-lg border border-border/60 bg-background px-4 py-3 shadow-[0_1px_2px_rgb(0_0_0_/_0.03)]">
      <div className="space-y-1">
        <div className="text-[15px] font-semibold leading-5 text-foreground">{request.title}</div>
        <div className="whitespace-pre-wrap text-[13px] leading-5 text-muted-foreground">
          {request.prompt}
        </div>
      </div>

      {readOnly ? (
        <div className="mt-4 rounded-lg bg-card-muted/70 px-3 py-2.5 text-[14px] leading-5 text-muted-foreground">
          {response?.ok
            ? submittedLabel(response.value)
            : response && 'cancelled' in response
              ? response.reason
              : response && 'expired' in response
                ? response.reason
                : t('chat.humanInput.submitted')}
        </div>
      ) : request.input.type === 'text' ? (
        <div className="mt-4 space-y-3">
          {request.input.multiline ? (
            <textarea
              value={typeof value === 'string' ? value : ''}
              onChange={(event) => setValue(event.target.value)}
              className={`${fieldClassName} min-h-24 resize-y`}
            />
          ) : (
            <input
              value={typeof value === 'string' ? value : ''}
              onChange={(event) => setValue(event.target.value)}
              className={fieldClassName}
            />
          )}
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void cancel()}
              className={secondaryButtonClassName}
            >
              <X className="size-3" />
              {t('chat.humanInput.cancel')}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submit(value)}
              className={primaryButtonClassName}
            >
              <Check className="size-3" />
              {t('chat.humanInput.submit')}
            </button>
          </div>
        </div>
      ) : selectInput ? (
        <div className="mt-4 space-y-3">
          <div className="space-y-2">
            {selectInput.options.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={submitting}
                aria-pressed={
                  selectInput.multiple === true
                    ? Array.isArray(value) && value.includes(option.value)
                    : value === option.value
                }
                onClick={() => toggleSelectValue(option.value)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-[14px] leading-5 transition disabled:opacity-60 ${
                  (
                    selectInput.multiple === true
                      ? Array.isArray(value) && value.includes(option.value)
                      : value === option.value
                  )
                    ? 'border-foreground/30 bg-card-muted text-foreground'
                    : 'border-transparent bg-card-muted/55 text-muted-foreground hover:bg-card-muted/80 hover:text-foreground'
                }`}
              >
                <span
                  className={`flex size-4 shrink-0 items-center justify-center border ${
                    selectInput.multiple === true ? 'rounded' : 'rounded-full'
                  } ${
                    (
                      selectInput.multiple === true
                        ? Array.isArray(value) && value.includes(option.value)
                        : value === option.value
                    )
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-muted-foreground/35 bg-background'
                  }`}
                >
                  {(selectInput.multiple === true
                    ? Array.isArray(value) && value.includes(option.value)
                    : value === option.value) && <Check className="size-3" strokeWidth={2.4} />}
                </span>
                <span className="min-w-0 flex-1">{option.label}</span>
              </button>
            ))}
            <label className="flex w-full items-center gap-3 rounded-lg border border-transparent bg-card-muted/55 px-3 py-2.5 text-left text-[14px] leading-5 text-muted-foreground transition focus-within:border-foreground/30 focus-within:bg-card-muted">
              <span
                className={`flex size-4 shrink-0 items-center justify-center border ${
                  selectInput.multiple === true ? 'rounded' : 'rounded-full'
                } ${
                  customValue.trim()
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-muted-foreground/35 bg-background'
                }`}
              >
                {customValue.trim() && <Check className="size-3" strokeWidth={2.4} />}
              </span>
              <span className="shrink-0 text-muted-foreground">{t('chat.humanInput.custom')}</span>
              <input
                value={customValue}
                disabled={submitting}
                onChange={(event) => {
                  const next = event.target.value
                  setCustomValue(next)
                  if (selectInput.multiple !== true) {
                    setValue(next)
                  }
                }}
                placeholder={t('chat.humanInput.customPlaceholder')}
                className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/55 disabled:opacity-60"
              />
            </label>
          </div>
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void cancel()}
              className={secondaryButtonClassName}
            >
              <X className="size-3" />
              {t('chat.humanInput.cancel')}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submit(selectValueForSubmit())}
              className={primaryButtonClassName}
            >
              <Check className="size-3" />
              {t('chat.humanInput.submit')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex justify-end gap-1.5">
          <button
            type="button"
            disabled={submitting}
            onClick={() => void cancel()}
            className={secondaryButtonClassName}
          >
            <X className="size-3" />
            {t('chat.humanInput.cancel')}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submit(true)}
            className={primaryButtonClassName}
          >
            <Check className="size-3" />
            {t('chat.humanInput.confirm')}
          </button>
        </div>
      )}

      {error && <div className="mt-2 text-[12px] text-destructive">{error}</div>}
    </div>
  )
}
