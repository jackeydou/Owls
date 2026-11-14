# Form Render Examples

## Basic Request Form

```json
{
  "renderer": "form-render",
  "title": "Supplement request details",
  "description": "Provide the missing details so the agent can continue.",
  "fields": [
    {
      "type": "text",
      "name": "summary",
      "label": "Summary",
      "required": true,
      "placeholder": "Briefly describe the request",
      "maxLength": 120
    },
    {
      "type": "textarea",
      "name": "context",
      "label": "Context",
      "description": "Include constraints, examples, or edge cases.",
      "required": true,
      "minLength": 10
    }
  ],
  "submit": {
    "label": "Submit details"
  }
}
```

## Selection Form

```json
{
  "renderer": "form-render",
  "title": "Choose a remediation plan",
  "initial_state": {
    "plan": "minimal",
    "notify_channels": ["workspace"]
  },
  "fields": [
    {
      "type": "select",
      "name": "plan",
      "label": "Plan",
      "required": true,
      "options": [
        { "label": "Minimal fix", "value": "minimal" },
        { "label": "Refactor affected module", "value": "refactor" },
        { "label": "Defer", "value": "defer" }
      ]
    },
    {
      "type": "multi_select",
      "name": "notify_channels",
      "label": "Notify channels",
      "options": [
        { "label": "Workspace", "value": "workspace" },
        { "label": "Email", "value": "email" },
        { "label": "Issue comment", "value": "issue_comment" }
      ],
      "minItems": 1,
      "maxItems": 2
    }
  ],
  "submit": {
    "label": "Use plan"
  }
}
```

## Review Edit Form

```json
{
  "renderer": "form-render",
  "title": "Review generated copy",
  "description": "Edit the proposed output before it is used.",
  "initial_state": {
    "headline": "Release notes draft",
    "body": "This release improves stability and fixes several bugs."
  },
  "fields": [
    {
      "type": "text",
      "name": "headline",
      "label": "Headline",
      "required": true,
      "maxLength": 80
    },
    {
      "type": "textarea",
      "name": "body",
      "label": "Body",
      "required": true,
      "minLength": 20
    },
    {
      "type": "boolean",
      "name": "approved_for_publish",
      "label": "Approved for publish"
    }
  ],
  "submit": {
    "label": "Submit edited copy"
  }
}
```

## Parameters Form

```json
{
  "renderer": "form-render",
  "title": "Configure run parameters",
  "fields": [
    {
      "type": "number",
      "name": "max_retries",
      "label": "Max retries",
      "required": true,
      "min": 0,
      "max": 5,
      "step": 1
    },
    {
      "type": "date",
      "name": "due_date",
      "label": "Due date"
    },
    {
      "type": "datetime",
      "name": "start_after",
      "label": "Start after"
    },
    {
      "type": "json",
      "name": "extra_payload",
      "label": "Extra payload",
      "description": "Provide a JSON object with additional runtime parameters."
    }
  ],
  "submit": {
    "label": "Start"
  }
}
```

## File Request Form

```json
{
  "renderer": "form-render",
  "title": "Attach supporting files",
  "description": "Upload files required to continue this workflow.",
  "fields": [
    {
      "type": "file",
      "name": "attachments",
      "label": "Attachments",
      "required": true,
      "accept": [".png", ".jpg", ".pdf", "application/json"],
      "multiple": true
    },
    {
      "type": "textarea",
      "name": "notes",
      "label": "Notes",
      "placeholder": "Explain what these files contain"
    }
  ],
  "submit": {
    "label": "Submit files"
  }
}
```

Example submit value:

```json
{
  "attachments": [
    {
      "name": "screenshot.png",
      "type": "image/png",
      "size": 12345,
      "lastModified": 1779999999999
    }
  ],
  "notes": "Screenshot showing the failed state."
}
```
