import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import type { HumanInputRuntimeContext } from '../human-input-runtime.js'
import { interruptForHumanInput } from '../human-input-runtime.js'

const humanInputControlSchema = Type.Union([
  Type.Object({
    type: Type.Literal('text'),
    multiline: Type.Optional(Type.Boolean()),
    required: Type.Optional(Type.Boolean())
  }),
  Type.Object({
    type: Type.Literal('select'),
    required: Type.Optional(Type.Boolean()),
    multiple: Type.Optional(Type.Boolean()),
    options: Type.Array(
      Type.Object({
        label: Type.String(),
        value: Type.String()
      }),
      { minItems: 1 }
    )
  }),
  Type.Object({
    type: Type.Literal('confirmation')
  })
])

const askUserInputSchema = Type.Object({
  title: Type.String({
    description: 'Short title for the input request shown to the user.'
  }),
  prompt: Type.String({
    description: 'Clear question or instruction for the user.'
  }),
  input: humanInputControlSchema,
  defaultValue: Type.Optional(Type.Unknown())
})

function createAskUserInputTool(
  runtimeContext: HumanInputRuntimeContext
): AgentTool<typeof askUserInputSchema> {
  return {
    name: 'ask_user',
    label: 'Ask User',
    description:
      'Ask the user for required input before continuing. Use exactly one input control shape: text {"type":"text","required":true}, multiline text {"type":"text","multiline":true,"required":true}, single-select {"type":"select","options":[{"label":"Option label","value":"option_value"}]}, multi-select {"type":"select","multiple":true,"options":[{"label":"Option label","value":"option_value"}]}, or confirmation {"type":"confirmation"}. Use select for option lists; users can choose an option or type a custom answer. Set multiple:true only when the user may choose more than one value.',
    parameters: askUserInputSchema,
    executionMode: 'sequential',
    async execute(toolCallId, params) {
      return interruptForHumanInput(runtimeContext, {
        toolCallId,
        toolName: 'ask_user',
        interruptKey: 'default',
        title: params.title,
        prompt: params.prompt,
        input: params.input,
        defaultValue: params.defaultValue,
        toolArgsSnapshot: params
      })
    }
  }
}

export { createAskUserInputTool }
