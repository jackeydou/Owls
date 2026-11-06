# Json Render Examples

## Summary Card

```json
{
  "renderer": "json-render",
  "spec": {
    "root": "root",
    "elements": {
      "root": {
        "type": "Card",
        "props": {
          "title": "Run summary",
          "description": "Latest workflow result"
        },
        "children": ["status"]
      },
      "status": {
        "type": "KeyValue",
        "props": {
          "items": [
            { "label": "Status", "value": { "$state": "/status" } },
            { "label": "Duration", "value": { "$state": "/duration" } },
            { "label": "Report", "value": { "$state": "/report_url" }, "format": "url" }
          ]
        }
      }
    }
  },
  "state_source": {
    "status": "succeeded",
    "duration": "42s",
    "report_url": "https://example.com/report"
  }
}
```

## Table From State

```json
{
  "renderer": "json-render",
  "spec": {
    "root": "root",
    "elements": {
      "root": {
        "type": "Section",
        "props": {
          "title": "Open risks",
          "description": "Rows are bound from state_source.risks"
        },
        "children": ["risk_table"]
      },
      "risk_table": {
        "type": "DataTable",
        "props": {
          "rows": { "$state": "/risks" },
          "columns": [
            { "label": "ID", "path": "id", "format": "code" },
            { "label": "Title", "path": "title" },
            { "label": "Owner", "path": "owner.name" },
            { "label": "Severity", "path": "severity" }
          ]
        }
      }
    }
  },
  "state_source": {
    "risks": [
      {
        "id": "R-1",
        "title": "Missing validation",
        "owner": { "name": "Platform" },
        "severity": "high"
      }
    ]
  }
}
```

## Area Chart

```json
{
  "renderer": "json-render",
  "spec": {
    "root": "root",
    "elements": {
      "root": {
        "type": "AreaChart",
        "props": {
          "title": "Traffic trend",
          "description": "Daily visitors by channel",
          "data": { "$state": "/traffic" },
          "xKey": "day",
          "series": [
            { "key": "desktop", "label": "Desktop", "color": "#2563eb" },
            { "key": "mobile", "label": "Mobile", "color": "#059669" }
          ],
          "showLegend": true
        }
      }
    }
  },
  "state_source": {
    "traffic": [
      { "day": "Mon", "desktop": 186, "mobile": 80 },
      { "day": "Tue", "desktop": 305, "mobile": 200 },
      { "day": "Wed", "desktop": 237, "mobile": 120 }
    ]
  }
}
```

## Pie Chart

```json
{
  "renderer": "json-render",
  "spec": {
    "root": "root",
    "elements": {
      "root": {
        "type": "PieChart",
        "props": {
          "title": "Visits by channel",
          "data": { "$state": "/channels" },
          "nameKey": "channel",
          "valueKey": "visits",
          "innerRadius": 48,
          "showLegend": true
        }
      }
    }
  },
  "state_source": {
    "channels": [
      { "channel": "Search", "visits": 420 },
      { "channel": "Social", "visits": 260 },
      { "channel": "Direct", "visits": 180 }
    ]
  }
}
```

## File State

```json
{
  "renderer": "json-render",
  "spec": {
    "root": "root",
    "elements": {
      "root": {
        "type": "JsonTree",
        "props": {
          "value": { "$state": "/" },
          "defaultExpandedDepth": 2
        }
      }
    }
  },
  "state_source": "./state/latest-result.json"
}
```

The file `./state/latest-result.json` must contain a JSON object.

## Good Composition Pattern

Use layout components to create readable hierarchy:

```json
{
  "root": "root",
  "elements": {
    "root": {
      "type": "Stack",
      "props": { "gap": "md" },
      "children": ["headline", "summary_grid", "details"]
    },
    "headline": {
      "type": "Heading",
      "props": { "text": { "$state": "/title" }, "level": 3 }
    },
    "summary_grid": {
      "type": "Grid",
      "props": { "columns": 2 },
      "children": ["metrics", "trend"]
    },
    "metrics": {
      "type": "KeyValue",
      "props": { "items": { "$state": "/metrics" } }
    },
    "trend": {
      "type": "LineChart",
      "props": {
        "data": { "$state": "/trend" },
        "xKey": "date",
        "series": [{ "key": "value", "label": "Value" }]
      }
    },
    "details": {
      "type": "JsonTree",
      "props": { "value": { "$state": "/details" } }
    }
  }
}
```
