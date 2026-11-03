import { Checkbox } from '@base-ui/react/checkbox'
import { CheckboxGroup } from '@base-ui/react/checkbox-group'
import { Field } from '@base-ui/react/field'
import { Fieldset } from '@base-ui/react/fieldset'
import { Form as BaseForm } from '@base-ui/react/form'
import { Input } from '@base-ui/react/input'
import { Button } from '@renderer/components/ui/button'
import { type ReactNode, useMemo } from 'react'
import { Controller, type RegisterOptions, useForm } from 'react-hook-form'
import type {
  FormRenderDocument,
  FormRenderField,
  FormRenderFileField,
  FormRenderMultiSelectField,
  FormRenderNumberField,
  FormRenderSelectField,
  FormRenderTextField
} from '../../../../shared/form-render'
import type { JsonRenderValue } from '../../../../shared/json-render'

type FormValues = Record<string, unknown>

export type FormRenderProps = {
  document: FormRenderDocument
  disabled?: boolean
  submitLabel?: string
  cancelLabel?: string
  onSubmit: (value: Record<string, JsonRenderValue>) => void | Promise<void>
  onCancel?: () => void
}

const fieldClassName =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] leading-5 text-foreground outline-none transition placeholder:text-muted-foreground/65 focus:border-accent/45 focus:ring-2 focus:ring-accent/15 disabled:opacity-60'

const checkboxClassName =
  'flex size-4 shrink-0 items-center justify-center rounded border border-border bg-background text-background data-checked:border-accent data-checked:bg-accent data-checked:text-accent-foreground disabled:opacity-60'

const FORM_RENDER_ROOT_ID = 'form:form-ui'

function fieldElementId(field: FormRenderField): string {
  return `field:${field.name}`
}

function fieldStatePointer(field: FormRenderField): string {
  return `/${field.name.replaceAll('~', '~0').replaceAll('/', '~1')}`
}

function CheckMark(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="size-3"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
    >
      <path d="m2.5 8.5 4 4 7-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function defaultValueForField(
  field: FormRenderField,
  initialState: Record<string, JsonRenderValue>
): unknown {
  const value = initialState[field.name]
  if (value !== undefined) {
    return field.type === 'json' ? JSON.stringify(value, null, 2) : value
  }
  if (field.type === 'boolean') return false
  if (field.type === 'multi_select') return []
  if (field.type === 'file') return field.multiple ? [] : null
  return ''
}

function buildDefaultValues(document: FormRenderDocument): FormValues {
  const initialState = document.initial_state ?? {}
  return Object.fromEntries(
    document.fields.map((field) => [field.name, defaultValueForField(field, initialState)])
  )
}

function normalizeFile(file: File): JsonRenderValue {
  return {
    name: file.name,
    type: file.type,
    size: file.size,
    lastModified: file.lastModified
  }
}

function normalizeValue(field: FormRenderField, value: unknown): JsonRenderValue {
  if (field.type === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : 0
    }
    return 0
  }
  if (field.type === 'boolean') return value === true
  if (field.type === 'multi_select') {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []
  }
  if (field.type === 'json') {
    if (typeof value !== 'string') return null
    try {
      return JSON.parse(value) as JsonRenderValue
    } catch {
      return null
    }
  }
  if (field.type === 'file') {
    if (field.multiple) {
      return Array.isArray(value)
        ? value.filter((item): item is JsonRenderValue => typeof item === 'object' && item !== null)
        : []
    }
    return typeof value === 'object' && value !== null ? (value as JsonRenderValue) : null
  }
  return typeof value === 'string'
    ? value
    : value === undefined || value === null
      ? ''
      : String(value)
}

function normalizeSubmitValue(
  fields: FormRenderField[],
  values: FormValues
): Record<string, JsonRenderValue> {
  return Object.fromEntries(
    fields.map((field) => [field.name, normalizeValue(field, values[field.name])])
  )
}

function requiredMessage(field: FormRenderField): string | undefined {
  return field.required ? `${field.label} is required.` : undefined
}

function textRules(field: FormRenderTextField): RegisterOptions<FormValues, string> {
  return {
    required: requiredMessage(field),
    minLength:
      field.minLength === undefined
        ? undefined
        : { value: field.minLength, message: `${field.label} is too short.` },
    maxLength:
      field.maxLength === undefined
        ? undefined
        : { value: field.maxLength, message: `${field.label} is too long.` }
  }
}

function numberRules(field: FormRenderNumberField): RegisterOptions<FormValues, string> {
  return {
    required: requiredMessage(field),
    valueAsNumber: true,
    min:
      field.min === undefined
        ? undefined
        : { value: field.min, message: `${field.label} must be at least ${field.min}.` },
    max:
      field.max === undefined
        ? undefined
        : { value: field.max, message: `${field.label} must be at most ${field.max}.` }
  }
}

function selectRules(field: FormRenderSelectField): RegisterOptions<FormValues, string> {
  const values = new Set(field.options.map((option) => option.value))
  return {
    required: requiredMessage(field),
    validate: (value) =>
      typeof value !== 'string' || !value || values.has(value) || `${field.label} is invalid.`
  }
}

function multiSelectRules(field: FormRenderMultiSelectField): RegisterOptions<FormValues, string> {
  const values = new Set(field.options.map((option) => option.value))
  return {
    validate: (value) => {
      const selected = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : []
      if (field.required && selected.length === 0) return `${field.label} is required.`
      if (field.minItems !== undefined && selected.length < field.minItems) {
        return `${field.label} needs at least ${field.minItems} item(s).`
      }
      if (field.maxItems !== undefined && selected.length > field.maxItems) {
        return `${field.label} allows at most ${field.maxItems} item(s).`
      }
      return selected.every((item) => values.has(item)) || `${field.label} is invalid.`
    }
  }
}

function jsonRules(field: FormRenderField): RegisterOptions<FormValues, string> {
  return {
    required: requiredMessage(field),
    validate: (value) => {
      if (typeof value !== 'string' || !value.trim())
        return field.required ? `${field.label} is required.` : true
      try {
        JSON.parse(value) as unknown
        return true
      } catch {
        return `${field.label} must be valid JSON.`
      }
    }
  }
}

function FormField({
  field,
  error,
  children
}: {
  field: FormRenderField
  error?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <Field.Root
      name={field.name}
      className="block space-y-1.5"
      invalid={Boolean(error)}
      data-pichu-render-node="true"
      data-pichu-renderer="form-render"
      data-pichu-surface="form-ui"
      data-pichu-element-id={fieldElementId(field)}
      data-pichu-element-type={field.type}
      data-pichu-parent-element-id={FORM_RENDER_ROOT_ID}
      data-pichu-state-pointer={fieldStatePointer(field)}
      data-pichu-label={field.label}
    >
      <Field.Label className="font-medium text-[12px] text-foreground">
        {field.label}
        {field.required ? <span className="text-destructive"> *</span> : null}
      </Field.Label>
      {field.description ? (
        <Field.Description className="block text-[12px] text-muted-foreground leading-5">
          {field.description}
        </Field.Description>
      ) : null}
      {children}
      {error ? (
        <Field.Error className="block text-[12px] text-destructive">{error}</Field.Error>
      ) : null}
    </Field.Root>
  )
}

function MultiSelectField({
  field,
  value,
  onChange,
  disabled
}: {
  field: FormRenderMultiSelectField
  value: unknown
  onChange: (value: string[]) => void
  disabled?: boolean
}): React.JSX.Element {
  const selected = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
  return (
    <CheckboxGroup
      value={selected}
      disabled={disabled || field.disabled}
      onValueChange={(nextValue) => onChange(nextValue)}
      className="space-y-1.5"
    >
      {field.options.map((option) => (
        <div
          key={option.value}
          className="flex items-center gap-2 rounded-lg border border-border/70 bg-background px-3 py-2 text-[13px] text-foreground"
          data-pichu-render-node="true"
          data-pichu-renderer="form-render"
          data-pichu-surface="form-ui"
          data-pichu-element-id={`${fieldElementId(field)}:option:${option.value}`}
          data-pichu-element-type="option"
          data-pichu-parent-element-id={fieldElementId(field)}
          data-pichu-state-pointer={fieldStatePointer(field)}
          data-pichu-label={option.label}
        >
          <Checkbox.Root
            aria-label={option.label}
            value={option.value}
            className={checkboxClassName}
          >
            <Checkbox.Indicator className="flex data-unchecked:hidden">
              <CheckMark />
            </Checkbox.Indicator>
          </Checkbox.Root>
          {option.label}
        </div>
      ))}
    </CheckboxGroup>
  )
}

function FileField({
  field,
  onChange,
  disabled
}: {
  field: FormRenderFileField
  onChange: (value: JsonRenderValue) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <Input
      type="file"
      multiple={field.multiple}
      accept={field.accept?.join(',')}
      disabled={disabled || field.disabled}
      className={fieldClassName}
      onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? [])
        onChange(
          field.multiple ? files.map(normalizeFile) : files[0] ? normalizeFile(files[0]) : null
        )
      }}
    />
  )
}

export function FormRender({
  document,
  disabled,
  submitLabel,
  cancelLabel,
  onSubmit,
  onCancel
}: FormRenderProps): React.JSX.Element {
  const defaultValues = useMemo(() => buildDefaultValues(document), [document])
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<FormValues>({ defaultValues })

  const submit = handleSubmit(async (values) => {
    await onSubmit(normalizeSubmitValue(document.fields, values))
  })

  return (
    <BaseForm
      className="w-full max-w-xl space-y-4 rounded-xl border border-border/70 bg-card p-4"
      onSubmit={(event) => void submit(event)}
      data-pichu-render-node="true"
      data-pichu-renderer="form-render"
      data-pichu-surface="form-ui"
      data-pichu-element-id={FORM_RENDER_ROOT_ID}
      data-pichu-element-type="Form"
      data-pichu-label={document.title}
    >
      {document.title || document.description ? (
        <div className="space-y-1">
          {document.title ? (
            <h3 className="font-semibold text-[15px] text-foreground">{document.title}</h3>
          ) : null}
          {document.description ? (
            <p className="text-[13px] text-muted-foreground leading-5">{document.description}</p>
          ) : null}
        </div>
      ) : null}

      <Fieldset.Root className="space-y-3">
        {document.fields.map((field) => {
          const error = errors[field.name]?.message
          if (field.type === 'textarea') {
            return (
              <FormField
                key={field.name}
                field={field}
                error={typeof error === 'string' ? error : undefined}
              >
                <textarea
                  {...register(field.name, textRules(field))}
                  disabled={disabled || field.disabled}
                  placeholder={field.placeholder}
                  className={`${fieldClassName} min-h-24 resize-y`}
                />
              </FormField>
            )
          }
          if (field.type === 'text') {
            return (
              <FormField
                key={field.name}
                field={field}
                error={typeof error === 'string' ? error : undefined}
              >
                <Input
                  {...register(field.name, textRules(field))}
                  disabled={disabled || field.disabled}
                  placeholder={field.placeholder}
                  className={fieldClassName}
                />
              </FormField>
            )
          }
          if (field.type === 'number') {
            return (
              <FormField
                key={field.name}
                field={field}
                error={typeof error === 'string' ? error : undefined}
              >
                <Input
                  {...register(field.name, numberRules(field))}
                  type="number"
                  disabled={disabled || field.disabled}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  className={fieldClassName}
                />
              </FormField>
            )
          }
          if (field.type === 'boolean') {
            return (
              <Controller
                key={field.name}
                name={field.name}
                control={control}
                render={({ field: rhfField }) => (
                  <FormField field={field} error={typeof error === 'string' ? error : undefined}>
                    <Checkbox.Root
                      className={checkboxClassName}
                      disabled={disabled || field.disabled}
                      checked={rhfField.value === true}
                      onCheckedChange={(checked) => rhfField.onChange(checked === true)}
                    >
                      <Checkbox.Indicator className="flex data-unchecked:hidden">
                        <CheckMark />
                      </Checkbox.Indicator>
                    </Checkbox.Root>
                  </FormField>
                )}
              />
            )
          }
          if (field.type === 'select') {
            return (
              <FormField
                key={field.name}
                field={field}
                error={typeof error === 'string' ? error : undefined}
              >
                <select
                  {...register(field.name, selectRules(field))}
                  disabled={disabled || field.disabled}
                  className={fieldClassName}
                >
                  <option value="">Select...</option>
                  {field.options.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      data-pichu-render-node="true"
                      data-pichu-renderer="form-render"
                      data-pichu-surface="form-ui"
                      data-pichu-element-id={`${fieldElementId(field)}:option:${option.value}`}
                      data-pichu-element-type="option"
                      data-pichu-parent-element-id={fieldElementId(field)}
                      data-pichu-state-pointer={fieldStatePointer(field)}
                      data-pichu-label={option.label}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              </FormField>
            )
          }
          if (field.type === 'multi_select') {
            return (
              <Controller
                key={field.name}
                name={field.name}
                control={control}
                rules={multiSelectRules(field)}
                render={({ field: rhfField }) => (
                  <FormField field={field} error={typeof error === 'string' ? error : undefined}>
                    <MultiSelectField
                      field={field}
                      value={rhfField.value}
                      disabled={disabled}
                      onChange={rhfField.onChange}
                    />
                  </FormField>
                )}
              />
            )
          }
          if (field.type === 'date' || field.type === 'datetime') {
            return (
              <FormField
                key={field.name}
                field={field}
                error={typeof error === 'string' ? error : undefined}
              >
                <Input
                  {...register(field.name, { required: requiredMessage(field) })}
                  type={field.type === 'datetime' ? 'datetime-local' : 'date'}
                  disabled={disabled || field.disabled}
                  className={fieldClassName}
                />
              </FormField>
            )
          }
          if (field.type === 'json') {
            return (
              <FormField
                key={field.name}
                field={field}
                error={typeof error === 'string' ? error : undefined}
              >
                <textarea
                  {...register(field.name, jsonRules(field))}
                  disabled={disabled || field.disabled}
                  className={`${fieldClassName} min-h-28 resize-y font-mono text-[12px]`}
                />
              </FormField>
            )
          }
          if (field.type === 'file') {
            return (
              <Controller
                key={field.name}
                name={field.name}
                control={control}
                rules={{ required: requiredMessage(field) }}
                render={({ field: rhfField }) => (
                  <FormField field={field} error={typeof error === 'string' ? error : undefined}>
                    <FileField field={field} disabled={disabled} onChange={rhfField.onChange} />
                  </FormField>
                )}
              />
            )
          }
          return null
        })}
      </Fieldset.Root>

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || isSubmitting}
            onClick={onCancel}
          >
            {cancelLabel ?? 'Cancel'}
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={disabled || isSubmitting}>
          {submitLabel ?? document.submit?.label ?? 'Submit'}
        </Button>
      </div>
    </BaseForm>
  )
}
