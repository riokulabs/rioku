/**
 * Plugin sideload API — Plan 09 T5.
 *
 * The daemon endpoint is currently a 501 stub (see
 * packages/daemon/internal/gateway/stage2_finals_routes.go::handlePluginSideload).
 * The frontend posts the multipart envelope so the form, the permission
 * guard, and the failure-mode UX can be validated end-to-end before the
 * real install pipeline lands (#142, #146).
 */
import { useMutation } from '@tanstack/react-query';

const BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1';

export interface SideloadInput {
  tenantSlug: string;
  archive: File;
  manifest: File | Blob;
}

export interface SideloadResult {
  /** True iff the daemon accepted the upload and queued the install. */
  accepted: boolean;
  /** Daemon-issued install id, when accepted. */
  installId?: string;
  /** Problem-detail title when the daemon rejected the upload. */
  errorTitle?: string;
  /** Problem-detail explanation. */
  errorDetail?: string;
  /** HTTP status returned by the daemon. */
  status: number;
}

/**
 * Posts the archive + manifest as multipart/form-data. Does NOT throw on
 * non-2xx responses — instead unwraps the daemon's problem-detail body so
 * the form can render the message inline.
 */
export async function sideloadPlugin(input: SideloadInput): Promise<SideloadResult> {
  const fd = new FormData();
  fd.append('archive', input.archive);
  fd.append('manifest', input.manifest);

  const url = `${BASE}/t/${encodeURIComponent(input.tenantSlug)}/plugins/sideload`;
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    body: fd,
  });

  if (res.ok) {
    let body: { installId?: string } = {};
    try {
      body = (await res.json()) as { installId?: string };
    } catch {
      // ignore
    }
    const ok: SideloadResult = { accepted: true, status: res.status };
    if (typeof body.installId === 'string') ok.installId = body.installId;
    return ok;
  }

  // Try to parse problem-detail; otherwise fall back to text.
  let title = 'Sideload failed';
  let detail = '';
  try {
    const body = (await res.json()) as { title?: string; detail?: string };
    if (typeof body.title === 'string') title = body.title;
    if (typeof body.detail === 'string') detail = body.detail;
  } catch {
    detail = res.statusText;
  }
  return { accepted: false, errorTitle: title, errorDetail: detail, status: res.status };
}

export function useSideloadPlugin() {
  return useMutation({
    mutationKey: ['plugin-sideload'],
    mutationFn: (input: SideloadInput) => sideloadPlugin(input),
  });
}
