/**
 * Stage-2 real-daemon API hooks for settings sub-pages.
 *
 * The OpenAPI spec does not (yet) include the settings family of endpoints
 * (`/api/v1/t/{tenant}/settings/{network,observability,auth-policy,webhooks,danger,...}`),
 * so Orval generates no clients for them. These hand-written TanStack Query
 * hooks call `customFetch` directly against the documented daemon routes.
 *
 * When the OpenAPI spec is extended (see `decisions-needed.md` items 07-001..07-009)
 * these hooks should be replaced 1:1 by Orval-generated equivalents.
 *
 * Endpoint reference (live in daemon today):
 *   PUT /api/v1/t/{tenant}/settings/network                    network config + caddy reload
 *   GET /api/v1/t/{tenant}/settings/network                    read current network config
 *   PUT /api/v1/t/{tenant}/settings/auth-policy                tenant auth policy
 *   PUT /api/v1/t/{tenant}/settings/observability/metrics      metrics config
 *   PUT /api/v1/t/{tenant}/settings/observability/logs         logs config
 *   PUT /api/v1/t/{tenant}/settings/observability/traces       traces config
 *   POST /api/v1/t/{tenant}/settings/webhooks/{id}/test         dispatch a synthetic webhook
 *   POST /api/v1/t/{tenant}/settings/danger/hard-reset          tenant hard reset
 *   GET /api/v1/t/{tenant}/settings/danger/export               tenant export blob
 *   DELETE /api/v1/t/{tenant}/settings/danger/tenant            tenant delete (super-admin)
 */

import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { customFetch } from '@/api/mutator';

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface NetworkConfig {
  listen_addresses?: string[];
  http3_enabled?: boolean;
  caddy_overrides?: Record<string, unknown>;
  read_timeout_seconds?: number;
  write_timeout_seconds?: number;
  idle_timeout_seconds?: number;
}

export interface AuthPolicyConfig {
  totp_policy: 'all' | 'admins' | 'optional';
  password_min_length: number;
  idle_session_timeout_seconds: number;
  absolute_session_timeout_seconds: number;
}

export interface MetricsConfig {
  scrape_endpoint?: string;
  scrape_auth?: 'none' | 'basic' | 'bearer';
  retention_days?: number;
}

export interface LogsConfig {
  level?: 'debug' | 'info' | 'warn' | 'error';
  format?: 'json' | 'text';
  rotation_days?: number;
}

export interface TracesConfig {
  retention_days?: number;
  sample_rate?: number;
  otlp_endpoint?: string;
}

export interface DangerHardResetBody {
  /** The tenant slug typed three times by the operator, joined with newlines. */
  confirmation: string;
}

// ─── Network ──────────────────────────────────────────────────────────────────

export function settingsNetworkUrl(tenant: string): string {
  return `/t/${encodeURIComponent(tenant)}/settings/network`;
}

export function getSettingsNetwork(tenant: string, signal?: AbortSignal): Promise<NetworkConfig> {
  return customFetch<NetworkConfig>({
    url: settingsNetworkUrl(tenant),
    method: 'GET',
    ...(signal !== undefined ? { signal } : {}),
  });
}

export function putSettingsNetwork(tenant: string, body: NetworkConfig): Promise<NetworkConfig> {
  return customFetch<NetworkConfig>({
    url: settingsNetworkUrl(tenant),
    method: 'PUT',
    data: body,
  });
}

export function useSettingsNetwork(tenant: string): UseQueryResult<NetworkConfig> {
  return useQuery({
    queryKey: ['settings', 'network', tenant],
    queryFn: ({ signal }) => getSettingsNetwork(tenant, signal),
  });
}

export function usePutSettingsNetwork(
  tenant: string,
): UseMutationResult<NetworkConfig, Error, NetworkConfig> {
  return useMutation({
    mutationFn: (body: NetworkConfig) => putSettingsNetwork(tenant, body),
  });
}

// ─── Auth policy ──────────────────────────────────────────────────────────────

export function settingsAuthPolicyUrl(tenant: string): string {
  return `/t/${encodeURIComponent(tenant)}/settings/auth-policy`;
}

export function putSettingsAuthPolicy(
  tenant: string,
  body: AuthPolicyConfig,
): Promise<AuthPolicyConfig> {
  return customFetch<AuthPolicyConfig>({
    url: settingsAuthPolicyUrl(tenant),
    method: 'PUT',
    data: body,
  });
}

export function usePutSettingsAuthPolicy(
  tenant: string,
): UseMutationResult<AuthPolicyConfig, Error, AuthPolicyConfig> {
  return useMutation({
    mutationFn: (body: AuthPolicyConfig) => putSettingsAuthPolicy(tenant, body),
  });
}

// ─── Observability ────────────────────────────────────────────────────────────

export function settingsObservabilityMetricsUrl(tenant: string): string {
  return `/t/${encodeURIComponent(tenant)}/settings/observability/metrics`;
}

export function settingsObservabilityLogsUrl(tenant: string): string {
  return `/t/${encodeURIComponent(tenant)}/settings/observability/logs`;
}

export function settingsObservabilityTracesUrl(tenant: string): string {
  return `/t/${encodeURIComponent(tenant)}/settings/observability/traces`;
}

export function putObservabilityMetrics(
  tenant: string,
  body: MetricsConfig,
): Promise<MetricsConfig> {
  return customFetch<MetricsConfig>({
    url: settingsObservabilityMetricsUrl(tenant),
    method: 'PUT',
    data: body,
  });
}

export function putObservabilityLogs(tenant: string, body: LogsConfig): Promise<LogsConfig> {
  return customFetch<LogsConfig>({
    url: settingsObservabilityLogsUrl(tenant),
    method: 'PUT',
    data: body,
  });
}

export function putObservabilityTraces(tenant: string, body: TracesConfig): Promise<TracesConfig> {
  return customFetch<TracesConfig>({
    url: settingsObservabilityTracesUrl(tenant),
    method: 'PUT',
    data: body,
  });
}

export function usePutObservabilityMetrics(
  tenant: string,
): UseMutationResult<MetricsConfig, Error, MetricsConfig> {
  return useMutation({
    mutationFn: (body: MetricsConfig) => putObservabilityMetrics(tenant, body),
  });
}

export function usePutObservabilityLogs(
  tenant: string,
): UseMutationResult<LogsConfig, Error, LogsConfig> {
  return useMutation({
    mutationFn: (body: LogsConfig) => putObservabilityLogs(tenant, body),
  });
}

export function usePutObservabilityTraces(
  tenant: string,
): UseMutationResult<TracesConfig, Error, TracesConfig> {
  return useMutation({
    mutationFn: (body: TracesConfig) => putObservabilityTraces(tenant, body),
  });
}

// ─── Integrations: webhook test send ──────────────────────────────────────────

export interface WebhookTestResult {
  delivered_at?: string;
  http_status?: number;
  duration_ms?: number;
  error?: string;
}

export function settingsWebhookTestUrl(tenant: string, id: string): string {
  return `/t/${encodeURIComponent(tenant)}/settings/webhooks/${encodeURIComponent(id)}/test`;
}

export function postWebhookTest(tenant: string, id: string): Promise<WebhookTestResult> {
  return customFetch<WebhookTestResult>({
    url: settingsWebhookTestUrl(tenant, id),
    method: 'POST',
  });
}

export function usePostWebhookTest(
  tenant: string,
): UseMutationResult<WebhookTestResult, Error, string> {
  return useMutation({
    mutationFn: (id: string) => postWebhookTest(tenant, id),
  });
}

// ─── Danger zone ──────────────────────────────────────────────────────────────

export function settingsDangerHardResetUrl(tenant: string): string {
  return `/t/${encodeURIComponent(tenant)}/settings/danger/hard-reset`;
}

export function settingsDangerExportUrl(tenant: string): string {
  return `/t/${encodeURIComponent(tenant)}/settings/danger/export`;
}

export function settingsDangerDeleteTenantUrl(tenant: string): string {
  return `/t/${encodeURIComponent(tenant)}/settings/danger/tenant`;
}

export function postDangerHardReset(
  tenant: string,
  body: DangerHardResetBody,
): Promise<{ ok: true }> {
  return customFetch<{ ok: true }>({
    url: settingsDangerHardResetUrl(tenant),
    method: 'POST',
    data: body,
  });
}

export function getDangerExport(tenant: string, signal?: AbortSignal): Promise<unknown> {
  return customFetch<unknown>({
    url: settingsDangerExportUrl(tenant),
    method: 'GET',
    ...(signal !== undefined ? { signal } : {}),
  });
}

export function deleteDangerTenant(tenant: string): Promise<undefined> {
  return customFetch<undefined>({
    url: settingsDangerDeleteTenantUrl(tenant),
    method: 'DELETE',
  });
}

export function usePostDangerHardReset(
  tenant: string,
): UseMutationResult<{ ok: true }, Error, DangerHardResetBody> {
  return useMutation({
    mutationFn: (body: DangerHardResetBody) => postDangerHardReset(tenant, body),
  });
}

export function useDeleteDangerTenant(
  tenant: string,
): UseMutationResult<undefined, Error, undefined> {
  return useMutation({
    mutationFn: () => deleteDangerTenant(tenant),
  });
}
