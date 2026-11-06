const {
  parseFlagMap,
  parseJsonValue,
  parsePayload,
  parseShellArgs,
  readStdin,
  toolCommand,
  writeJson
} = require('./hook-utils.js')

function buildDatabaseApprovalDemo(command) {
  const parsed = parseShellArgs(command)
  const { flags, positionals } = parseFlagMap(parsed.argv)
  const fields = parseJsonValue(flags.fields, [])
  const partitionKeys = parseJsonValue(flags['partition-keys'], [])
  const commandKind = positionals.slice(0, 3).join(' ')
  const tableName = String(flags.table ?? '')

  return {
    commandKind,
    parseStatus: parsed.status,
    summaryItems: [
      { label: 'Command', value: commandKind || 'unknown' },
      { label: 'Environment', value: flags.environment ?? '-' },
      { label: 'Region', value: flags.region ?? '-' },
      { label: 'Database', value: flags.database ?? '-' },
      { label: 'Table', value: tableName || '-' },
      { label: 'Cluster', value: flags['cluster-name'] ?? '-' },
      { label: 'Engine', value: flags.engine ?? '-' },
      { label: 'TTL days', value: flags.ttl ?? '-' }
    ],
    fieldRows: Array.isArray(fields)
      ? fields.map((field) => ({
          name: field?.name ?? '',
          type: field?.type ?? '',
          doc: field?.doc ?? ''
        }))
      : [],
    keyRows: [
      { name: 'Primary key', value: flags['primary-key'] ?? '-' },
      { name: 'Shard key', value: flags['shard-key'] ?? '-' },
      { name: 'Sample key', value: flags['sample-key'] ?? '-' },
      { name: 'Unique keys', value: flags['unique-keys'] ?? '-' },
      { name: 'Version field', value: flags['version-field'] ?? '-' }
    ],
    optionRows: [
      {
        name: 'Partition-level unique keys',
        value: String(flags['partition-level-unique-keys'] ?? '-')
      },
      {
        name: 'Disk-based unique key index',
        value: String(flags['enable-disk-based-unique-key-index'] ?? '-')
      }
    ],
    partitionKeys,
    riskNotes: [
      'Creates or changes a database table definition.',
      'Review database, table, cluster, TTL, key columns, and field types before approving.'
    ],
    rawCommand: command
  }
}

readStdin((input) => {
  const payload = parsePayload(input)
  const command = toolCommand(payload)

  if (command.includes('hook-deny')) {
    writeJson({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: 'Denied by test-hooks-plugin PreToolUse hook.'
      }
    })
    return
  }

  if (command.includes('hook-allow')) {
    writeJson({
      hookSpecificOutput: {
        permissionDecision: 'allow'
      }
    })
    return
  }

  if (command.includes('hook-ask')) {
    writeJson({
      hookSpecificOutput: {
        permissionDecision: 'ask'
      }
    })
    return
  }

  if (command.includes('hook-approval-demo') || command.includes('table create')) {
    const demoState = buildDatabaseApprovalDemo(command)

    writeJson({
      hookSpecificOutput: {
        permissionDecision: 'ask',
        approvalUi: {
          renderer: 'json-render',
          state: demoState,
          spec: {
            root: 'root',
            elements: {
              root: {
                type: 'Stack',
                props: {
                  gap: 'md'
                },
                children: [
                  'warning',
                  'summary',
                  'fields',
                  'keys',
                  'options',
                  'partitionKeys',
                  'parsedArgv',
                  'rawCommand'
                ]
              },
              warning: {
                type: 'Callout',
                props: {
                  title: 'Database table approval',
                  body: { $state: '/riskNotes/1' },
                  tone: 'warning'
                },
                children: []
              },
              summary: {
                type: 'KeyValue',
                props: {
                  items: { $state: '/summaryItems' }
                },
                children: []
              },
              fields: {
                type: 'Section',
                props: {
                  title: 'Fields'
                },
                children: ['fieldsTable']
              },
              fieldsTable: {
                type: 'DataTable',
                props: {
                  columns: [
                    { label: 'Name', path: 'name' },
                    { label: 'Type', path: 'type' },
                    { label: 'Description', path: 'doc' }
                  ],
                  rows: { $state: '/fieldRows' }
                },
                children: []
              },
              keys: {
                type: 'Section',
                props: {
                  title: 'Keys'
                },
                children: ['keysTable']
              },
              keysTable: {
                type: 'DataTable',
                props: {
                  columns: [
                    { label: 'Key', path: 'name' },
                    { label: 'Value', path: 'value' }
                  ],
                  rows: { $state: '/keyRows' }
                },
                children: []
              },
              options: {
                type: 'Section',
                props: {
                  title: 'Options'
                },
                children: ['optionsTable']
              },
              optionsTable: {
                type: 'DataTable',
                props: {
                  columns: [
                    { label: 'Option', path: 'name' },
                    { label: 'Value', path: 'value' }
                  ],
                  rows: { $state: '/optionRows' }
                },
                children: []
              },
              partitionKeys: {
                type: 'Section',
                props: {
                  title: 'Partition keys'
                },
                children: ['partitionKeysTree']
              },
              partitionKeysTree: {
                type: 'JsonTree',
                props: {
                  value: { $state: '/partitionKeys' },
                  defaultExpandedDepth: 2
                },
                children: []
              },
              parsedArgv: {
                type: 'Section',
                props: {
                  title: 'Parsed command arguments'
                },
                children: ['parsedArgvTree']
              },
              parsedArgvTree: {
                type: 'JsonTree',
                props: {
                  value: { $state: '/parsedCommand/argv' },
                  defaultExpandedDepth: 1
                },
                children: []
              },
              rawCommand: {
                type: 'Section',
                props: {
                  title: 'Raw command'
                },
                children: ['rawCommandBlock']
              },
              rawCommandBlock: {
                type: 'CodeBlock',
                props: {
                  language: 'shell',
                  code: { $state: '/rawCommand' }
                },
                children: []
              }
            }
          }
        }
      }
    })
    return
  }

  if (command.includes('hook-approval-ui')) {
    writeJson({
      hookSpecificOutput: {
        permissionDecision: 'ask',
        approvalUi: {
          renderer: 'json-render',
          spec: {
            root: 'root',
            elements: {
              root: {
                type: 'Stack',
                props: {
                  gap: 'md'
                },
                children: ['summary', 'details', 'argv', 'command', 'policyLink', 'preview']
              },
              summary: {
                type: 'Callout',
                props: {
                  title: 'Approval UI hook test',
                  body: 'This approval request is rendered from test-hooks-plugin using json-render.',
                  tone: 'info'
                },
                children: []
              },
              details: {
                type: 'KeyValue',
                props: {
                  items: [
                    {
                      label: 'Tool',
                      value: { $state: '/toolName' }
                    },
                    {
                      label: 'Working directory',
                      value: { $state: '/cwd' },
                      format: 'path'
                    },
                    {
                      label: 'Original command',
                      value: { $state: '/toolInput/command' },
                      format: 'code'
                    }
                  ]
                },
                children: []
              },
              command: {
                type: 'CodeBlock',
                props: {
                  code: { $state: '/toolInput/command' },
                  language: 'shell'
                },
                children: []
              },
              argv: {
                type: 'JsonTree',
                props: {
                  value: { $state: '/parsedCommand/argv' },
                  defaultExpandedDepth: 1
                },
                children: []
              },
              policyLink: {
                type: 'Link',
                props: {
                  href: 'https://example.com/test-hooks-plugin/approval-ui',
                  label: 'Open example review policy'
                },
                children: []
              },
              preview: {
                type: 'Image',
                props: {
                  src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
                  alt: 'Test approval preview',
                  caption: '1px data image used to verify the Image component.',
                  maxHeight: 120
                },
                children: []
              }
            }
          }
        }
      }
    })
    return
  }

  if (command.includes('hook-rewrite')) {
    writeJson({
      hookSpecificOutput: {
        updatedInput: {
          command: 'echo rewritten-by-test-hooks-plugin'
        }
      }
    })
    return
  }

  writeJson({})
})
