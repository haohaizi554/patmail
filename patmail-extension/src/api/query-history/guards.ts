import { isRecord } from '../response-guards'
import { isQueryGuid } from '../../query/query-validator'

export function isHistoryOption(value: unknown): value is { query_id: string; title: string } {
  return isRecord(value) && typeof value.query_id === 'string' && isQueryGuid(value.query_id) &&
    typeof value.title === 'string' && value.title.trim().length > 0
}
