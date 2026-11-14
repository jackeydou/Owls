import { isJsonRenderState, isJsonRenderValue, type JsonRenderValue } from './json-render.js'

export type FormRenderOption = {
  label: string
  value: string
}

export type FormRenderBaseField = {
  name: string
  label: string
  description?: string
  required?: boolean
  disabled?: boolean
}

export type FormRenderTextField = FormRenderBaseField & {
  type: 'text' | 'textarea'
  placeholder?: string
  minLength?: number
  maxLength?: number
}

export type FormRenderNumberField = FormRenderBaseField & {
  type: 'number'
  min?: number
  max?: number
  step?: number
}

export type FormRenderBooleanField = FormRenderBaseField & {
  type: 'boolean'
}

export type FormRenderSelectField = FormRenderBaseField & {
  type: 'select'
  options: FormRenderOption[]
}

export type FormRenderMultiSelectField = FormRenderBaseField & {
  type: 'multi_select'
  options: FormRenderOption[]
  minItems?: number
  maxItems?: number
}

export type FormRenderDateField = FormRenderBaseField & {
  type: 'date' | 'datetime'
}

export type FormRenderJsonField = FormRenderBaseField & {
  type: 'json'
}

export type FormRenderFileField = FormRenderBaseField & {
  type: 'file'
  accept?: string[]
  multiple?: boolean
}

export type FormRenderField =
  | FormRenderTextField
  | FormRenderNumberField
  | FormRenderBooleanField
  | FormRenderSelectField
  | FormRenderMultiSelectField
  | FormRenderDateField
  | FormRenderJsonField
  | FormRenderFileField

export type FormRenderDocument = {
  renderer: 'form-render'
  title?: string
  description?: string
  initial_state?: Record<string, JsonRenderValue>
  fields: FormRenderField[]
  submit?: {
    label?: string
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isOption(value: unknown): value is FormRenderOption {
  return (
    isRecord(value) &&
    typeof value.label === 'string' &&
    value.label.trim().length > 0 &&
    typeof value.value === 'string'
  )
}

function isBaseField(value: Record<string, unknown>): boolean {
  return (
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.label === 'string' &&
    value.label.trim().length > 0 &&
    (value.description === undefined || typeof value.description === 'string') &&
    (value.required === undefined || typeof value.required === 'boolean') &&
    (value.disabled === undefined || typeof value.disabled === 'boolean')
  )
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

export function isFormRenderField(value: unknown): value is FormRenderField {
  if (!isRecord(value) || !isBaseField(value) || typeof value.type !== 'string') return false
  if (value.type === 'text' || value.type === 'textarea') {
    return (
      (value.placeholder === undefined || typeof value.placeholder === 'string') &&
      optionalNumber(value.minLength) &&
      optionalNumber(value.maxLength)
    )
  }
  if (value.type === 'number') {
    return optionalNumber(value.min) && optionalNumber(value.max) && optionalNumber(value.step)
  }
  if (value.type === 'boolean' || value.type === 'date' || value.type === 'datetime') return true
  if (value.type === 'select') {
    return Array.isArray(value.options) && value.options.length > 0 && value.options.every(isOption)
  }
  if (value.type === 'multi_select') {
    return (
      Array.isArray(value.options) &&
      value.options.length > 0 &&
      value.options.every(isOption) &&
      optionalNumber(value.minItems) &&
      optionalNumber(value.maxItems)
    )
  }
  if (value.type === 'json') return true
  if (value.type === 'file') {
    return (
      (value.accept === undefined || isStringArray(value.accept)) &&
      (value.multiple === undefined || typeof value.multiple === 'boolean')
    )
  }
  return false
}

export function isFormRenderDocument(value: unknown): value is FormRenderDocument {
  return (
    isRecord(value) &&
    value.renderer === 'form-render' &&
    (value.title === undefined || typeof value.title === 'string') &&
    (value.description === undefined || typeof value.description === 'string') &&
    (value.initial_state === undefined || isJsonRenderState(value.initial_state)) &&
    Array.isArray(value.fields) &&
    value.fields.length > 0 &&
    value.fields.every(isFormRenderField) &&
    (value.submit === undefined ||
      (isRecord(value.submit) &&
        (value.submit.label === undefined || typeof value.submit.label === 'string')))
  )
}

export function isFormRenderSubmitValue(value: unknown): value is Record<string, JsonRenderValue> {
  return isRecord(value) && Object.values(value).every((item) => isJsonRenderValue(item))
}
