# RFC: Form Render UI Protocol

## Status

Draft technical design for structured user-input rendering in Owls Client.

## Abstract

Form Render 是 Owls Client 中面向人工补充信息的交互式 UI 协议。它和 `json-render` 分工明确：

- `json-render`：只读展示，负责把结构化 JSON state 渲染成安全 UI。
- `form-render`：可编辑输入，负责渲染字段、校验用户输入，并在 submit 时产出结构化 JSON。

核心协议：

```json
{
  "renderer": "form-render",
  "title": "补充工单信息",
  "description": "请确认以下字段后提交。",
  "initial_state": {
    "priority": "P1"
  },
  "fields": [
    {
      "name": "summary",
      "type": "text",
      "label": "工单标题",
      "required": true
    },
    {
      "name": "priority",
      "type": "select",
      "label": "优先级",
      "options": [
        { "label": "P0", "value": "P0" },
        { "label": "P1", "value": "P1" },
        { "label": "P2", "value": "P2" }
      ]
    }
  ],
  "submit": {
    "label": "提交"
  }
}
```

用户提交后输出：

```json
{
  "summary": "修复高危漏洞",
  "priority": "P1"
}
```

## Motivation

automation runtime、自动化和 agent workflow 中有两类人工暂停：

- 用户只需要做决策：继续、拒绝、确认已读。这是 approval。
- 用户需要补充内容：填写参数、选择候选项、编辑字段、选择文件。这是 form submit。

如果把两者都塞进 `json-render` 或一个泛化 `HITL` 节点，会导致 renderer 同时承担展示、状态管理、表单校验、提交、审批决策和恢复语义，边界不清。`form-render` 将“用户产出结构化数据”单独建模，让 `json-render` 继续保持只读、安全、可复用。

## Goals

- 定义 `form-render` 文档 schema。
- 支持常见字段类型：文本、数字、布尔、单选、多选、日期、JSON、文件引用等。
- 支持 `initial_state` 预填值。
- 支持字段级校验和 submit 输出。
- 明确 `form-render` 与 `json-render`、approval 的边界。
- 支持 automation runtime `form_submit` stage 挂起、恢复和把提交结果写入 `ctx.data`。

## Non-Goals

- 不允许表单 JSON 注入任意 React 组件、HTML、CSS 或事件 handler。
- 不把 `form-render` 设计成通用低代码应用运行时。
- 不在表单内部执行 shell、IPC、网络请求或数据库查询。
- 不支持远程 schema URL。
- 不替代 approval；approve / deny / acknowledge 仍是 approval 节点的职责。

## Protocol Shape

```ts
type FormRenderDocument = {
  renderer: 'form-render'
  title?: string
  description?: string
  initial_state?: Record<string, JsonValue>
  fields: FormField[]
  submit?: {
    label?: string
  }
}
```

`initial_state` 必须是 JSON object。字段的 `name` 是 submit 输出 object 的 key。

## Field Types

### Shared Field Props

所有字段共享：

```ts
type BaseField = {
  name: string
  label: string
  description?: string
  required?: boolean
  disabled?: boolean
}
```

字段名规则：

- 必须稳定。
- 建议使用 lower snake case，例如 `ticket_summary`。
- 不建议使用嵌套 path。首版输出 flat object；后续如需要嵌套输出再单独设计 `output_path`。

### Text

```ts
type TextField = BaseField & {
  type: 'text' | 'textarea'
  placeholder?: string
  minLength?: number
  maxLength?: number
}
```

输出：`string`

### Number

```ts
type NumberField = BaseField & {
  type: 'number'
  min?: number
  max?: number
  step?: number
}
```

输出：`number`

### Boolean

```ts
type BooleanField = BaseField & {
  type: 'boolean'
}
```

输出：`boolean`

### Select

```ts
type SelectField = BaseField & {
  type: 'select'
  options: Array<{ label: string; value: string }>
}
```

输出：`string`

### Multi Select

```ts
type MultiSelectField = BaseField & {
  type: 'multi_select'
  options: Array<{ label: string; value: string }>
  minItems?: number
  maxItems?: number
}
```

输出：`string[]`

### Date And DateTime

```ts
type DateField = BaseField & {
  type: 'date' | 'datetime'
}
```

输出：ISO-like `string`。日期时区语义由调用方定义。

### JSON

```ts
type JsonField = BaseField & {
  type: 'json'
}
```

输出：`JsonValue`。Renderer 必须先解析并校验是 JSON 后才能 submit。

### File

```ts
type FileField = BaseField & {
  type: 'file'
  accept?: string[]
  multiple?: boolean
}
```

输出：文件引用 object 或 object array。具体 shape 由承载场景定义，例如本地 path、artifact id 或 app-managed file id。文件字段需要独立权限边界，不应假装成普通 string input。

## Validation And Submit

Submit 流程：

1. Renderer 从 `initial_state` 初始化字段值。
2. 用户编辑字段。
3. Submit 时执行字段级校验。
4. 校验通过后产出 `Record<string, JsonValue>`。
5. 调用方把输出写入自己的 runtime 状态，例如 automation runtime `response_json`。

校验失败时：

- 不提交。
- 在字段旁显示可理解错误。
- 不改变 workflow runtime 状态。

## Relationship To Json Render

`form-render` 不内嵌 `json-render` 的 event/action 机制。需要展示上下文时，承载场景可以在 form 外部并排渲染一个 `JsonRenderDocument`：

```json
{
  "context_ui": {
    "renderer": "json-render",
    "spec": {}
  },
  "form_ui": {
    "renderer": "form-render",
    "fields": []
  }
}
```

这样可以保持：

- `json-render` 只读展示。
- `form-render` 只负责输入和 submit。
- Approval 只负责 decision。

## automation runtime Usage

automation runtime stage 类型应拆分为：

- `approval`：展示只读 `json-render` 上下文，并让用户 approve / deny / acknowledge。
- `form_submit`：展示 `form-render` 表单，并在 submit 后把表单 JSON 写入 `ctx.data`。

示例：

```json
{
  "stage_id": "stage_2_collect_ticket_fields",
  "type": "form_submit",
  "description": "等待用户补充工单字段",
  "config": {
    "form": {
      "renderer": "form-render",
      "title": "补充工单字段",
      "fields": [
        { "name": "summary", "type": "text", "label": "标题", "required": true },
        {
          "name": "priority",
          "type": "select",
          "label": "优先级",
          "options": [
            { "label": "P0", "value": "P0" },
            { "label": "P1", "value": "P1" }
          ]
        }
      ]
    }
  }
}
```

提交后 runtime 写入：

- `ctx.data.__form_result__`
- `ctx.data.__form_results__[stageId]`

如果 stage 作者需要把表单结果合并到业务字段，应在后续 code stage 中显式读取并转换，避免 runtime 隐式改写业务 data。

## Failure Strategy

- 表单 schema 无效：保存或启动 stage 时 fail-closed。
- 表单提交校验失败：保持 request pending。
- 表单提交成功但 runtime 恢复失败：保留已提交 response，恢复逻辑必须幂等。
- 文件字段解析失败：保持 request pending，并显示字段错误。

## Implementation Plan

`form-render` 使用 React Hook Form 作为 renderer 内部实现细节。对外协议仍然是 `FormRenderDocument`，调用方不需要知道或传入 React Hook Form 配置。

模块拆分：

- `apps/pichu-client/src/shared/form-render.ts`
  - 定义 `FormRenderDocument`、`FormRenderField` 和 runtime guards。
  - 校验 document shape、字段类型、options、`initial_state`。
- `apps/pichu-client/src/renderer/src/components/form-render/FormRender.tsx`
  - 使用 `useForm` 初始化动态字段。
  - 用 `register` 处理 text、textarea、number、select、date、datetime、json。
  - 用 `Controller` 处理 boolean、multi_select、file 等非纯文本输入。
  - Submit 时把 RHF values 归一化为 `Record<string, JsonValue>` 后调用 `onSubmit`。
- automation runtime 或其他承载容器
  - 负责传入 document、处理 `onSubmit`、调用 IPC 或 runtime resume。
  - `form-render` 本身不直接调用 IPC，不知道 automation runtime。

选择 React Hook Form 的原因：

- 适合 runtime schema 生成的动态字段。
- 字段注册、校验和 submit lifecycle 足够轻量。
- 可以用 `Controller` 包住自定义字段组件。
- Electron renderer 内使用简单，不依赖 server action。
- 不把外部协议绑定到某个第三方 schema form 格式。

首版实现不引入 JSON Schema Form、TanStack Form、Formisch 或 `useActionState`：

- JSON Schema Form 会把外部协议和 JSON Schema/UI Schema 绑定得过重。
- TanStack Form 的静态类型优势对 runtime JSON schema 帮助有限。
- Formisch 生态和团队熟悉度风险更高。
- `useActionState` 更偏 server/action submit，不适合本地 Electron dynamic form。

## Open Questions

- 是否需要 `output_path` 支持嵌套输出。
- 是否需要 schema-level cross-field validation。
- 文件字段输出应统一为 app-managed file id，还是按调用点定义。
- 是否需要在 form 外层标准化一个可选 `context_ui`。
