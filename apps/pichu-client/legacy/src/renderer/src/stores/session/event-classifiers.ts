import type { ContextCompactionMarker } from '../../../../shared/context-compaction'
import { isRecord } from './utils'

export function isContextCompactionEvent(
  event: unknown
): event is { type: 'context_compaction'; marker: ContextCompactionMarker } {
  return isRecord(event) && event.type === 'context_compaction' && isRecord(event.marker)
}
