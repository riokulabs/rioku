// Builds Content Security Policy headers for dev and prod.
// See spec §10.4. Dev relaxes 'unsafe-eval' + 'unsafe-inline' for Vite HMR.

const common = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'", // Mantine CSS-in-JS requires this
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];

export function prodCsp(nonce: string, daemonOrigin = "'self'"): string {
  return [
    ...common,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `connect-src 'self' ${daemonOrigin}`,
    "require-trusted-types-for 'script'",
  ].join("; ");
}

export function devCsp(nonce: string, viteHost: string, vitePort: number): string {
  return [
    ...common,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' 'unsafe-inline'`,
    `connect-src 'self' ws://${viteHost}:${vitePort} http://${viteHost}:${vitePort}`,
  ].join("; ");
}

export function randomNonce(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}
