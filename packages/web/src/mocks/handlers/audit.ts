import { http, HttpResponse } from 'msw'
import { mockAuditEntries } from '../data/audit'

export const auditHandlers = [
  http.get('/api/v1/audit', ({ request }) => {
    const url = new URL(request.url)
    let entries = [...mockAuditEntries]

    // Filter by actor
    const actor = url.searchParams.get('actor')
    if (actor) {
      entries = entries.filter((e) => e.actor === actor)
    }

    // Filter by entity type
    const entityType = url.searchParams.get('entityType')
    if (entityType) {
      entries = entries.filter((e) => e.entityType === entityType)
    }

    // Filter by operation
    const operation = url.searchParams.get('operation')
    if (operation) {
      entries = entries.filter((e) => e.operation === operation)
    }

    // Filter by date range
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (from) {
      entries = entries.filter((e) => e.occurredAt >= from)
    }
    if (to) {
      entries = entries.filter((e) => e.occurredAt <= to)
    }

    // Sort by occurredAt descending
    entries.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))

    return HttpResponse.json(entries)
  }),
]
