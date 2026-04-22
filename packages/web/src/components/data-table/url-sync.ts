/**
 * url-sync.ts — URL search param encoding/decoding helpers for <DataTable>.
 *
 * Pagination and sort state are encoded as:
 *   ?<key>_p=N          — current page (1-based)
 *   ?<key>_s=M          — page size
 *   ?<key>_sort=colId:asc|desc  — sort column and direction
 *
 * Per-column filter URL-sync uses useOpaqueFilter for PII carve-out.
 * This module handles only pagination + sort encoding for stage 1.
 */

export interface UrlSortState {
  id: string;
  desc: boolean;
}

export interface UrlTableState {
  page: number;
  pageSize: number;
  sort: UrlSortState | null;
}

/** Encode page state into search param key names. */
export function encodeUrlState(key: string, state: UrlTableState): Record<string, string> {
  const params: Record<string, string> = {
    [`${key}_p`]: String(state.page),
    [`${key}_s`]: String(state.pageSize),
  };
  if (state.sort) {
    params[`${key}_sort`] = `${state.sort.id}:${state.sort.desc ? 'desc' : 'asc'}`;
  }
  return params;
}

/** Decode URL search params back into table state. */
export function decodeUrlState(
  key: string,
  search: Record<string, unknown>,
  defaults: { pageSize: number },
): UrlTableState {
  const rawPage = search[`${key}_p`];
  const rawSize = search[`${key}_s`];
  const rawSort = search[`${key}_sort`];

  const page = typeof rawPage === 'string' ? Math.max(1, parseInt(rawPage, 10) || 1) : 1;
  const pageSize =
    typeof rawSize === 'string'
      ? Math.max(1, parseInt(rawSize, 10) || defaults.pageSize)
      : defaults.pageSize;

  let sort: UrlSortState | null = null;
  if (typeof rawSort === 'string' && rawSort.includes(':')) {
    const colonIdx = rawSort.lastIndexOf(':');
    const id = rawSort.slice(0, colonIdx);
    const dir = rawSort.slice(colonIdx + 1);
    if (id) {
      sort = { id, desc: dir === 'desc' };
    }
  }

  return { page, pageSize, sort };
}
