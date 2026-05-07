# Subdomain Mode — Development Guide

This document explains how to set up and test **subdomain URL mode** for Rioku tenants
in local development. Subdomain mode routes tenant traffic through host-based routing
(e.g. `acme.localhost:7778`) instead of path-based routing (e.g. `localhost:7778/t/acme/`).

## Overview

When a tenant's `url_mode` is set to `subdomain`, the daemon:

- Issues session cookies with `Domain=.<parent_domain>` (e.g. `Domain=.localhost`)
- Uses `SameSite=Lax` instead of `SameSite=Strict` so cookies are shared across subdomains
- Expects traffic on `<slug>.<parent_domain>:<port>` (e.g. `acme.localhost:7778`)

The sandbox cert-gen tool generates a wildcard self-signed certificate covering
`*.localhost` and `*.tenant.localhost`, which the daemon uses when a tenant has
`url_mode=subdomain`.

## Certificate Friction

Browsers **reject self-signed wildcard certificates** by default. You must install the
sandbox CA certificate in your OS and/or browser trust store before subdomain mode
will work without TLS errors.

This is a one-time setup per development machine.

### Generate the certificates

```bash
make sandbox-certs
```

This runs `sandbox/tools/cert-gen` and writes:

- `sandbox/.data/certs/ca.pem` — the CA certificate to install in your trust store
- `sandbox/.data/certs/leaf.pem` — the wildcard leaf cert used by the daemon
- `sandbox/.data/certs/leaf-key.pem` — the corresponding private key

The leaf cert covers `localhost`, `*.localhost`, and `*.tenant.localhost`.

### Install the CA certificate

#### macOS

```bash
sudo security add-trusted-cert \
  -d -r trustRoot \
  -k /Library/Keychains/System.keychain \
  sandbox/.data/certs/ca.pem
```

Restart Chrome or Safari after importing. Firefox uses its own trust store (see below).

#### Linux (ca-trust / update-ca-certificates)

On Debian/Ubuntu:

```bash
sudo cp sandbox/.data/certs/ca.pem /usr/local/share/ca-certificates/rioku-sandbox-ca.crt
sudo update-ca-certificates
```

On Fedora/RHEL:

```bash
sudo cp sandbox/.data/certs/ca.pem /etc/pki/ca-trust/source/anchors/rioku-sandbox-ca.pem
sudo update-ca-trust extract
```

Chrome and Chromium on Linux use the OS trust store. Restart the browser after updating.

#### Windows

```powershell
Import-Certificate `
  -FilePath sandbox\.data\certs\ca.pem `
  -CertStoreLocation Cert:\LocalMachine\Root
```

Or use `certmgr.msc` → Trusted Root Certification Authorities → Import.

### Firefox (all platforms)

Firefox does **not** use the OS certificate store. You must import the CA manually:

1. Open Firefox → Preferences (or `about:preferences`)
2. Search for "certificates" → **View Certificates**
3. Go to the **Authorities** tab → **Import**
4. Select `sandbox/.data/certs/ca.pem`
5. Check **"Trust this CA to identify websites"** → OK
6. Restart Firefox

## Verifying the setup

Test with curl before opening a browser:

```bash
curl --cacert sandbox/.data/certs/ca.pem \
  https://acme.localhost:7778/api/v1/health
```

Expected response: `{"status":"ok"}` (or similar health payload).

If you see a certificate error, the CA was not imported correctly.

## Development workflow

### Start the sandbox in subdomain mode

```bash
make sandbox-dev-web
```

The Vite dev server listens on `0.0.0.0:5173` with:

- `allowedHosts: ['localhost', /^.*\.localhost$/]` — accepts `*.localhost` requests
- `hmr.host: 'localhost'` — HMR websocket always connects through `localhost`

Visit the URL printed by `make sandbox-dev-web`:

```
http://t1.localhost:5173/t/acme/dashboard
```

(Replace `t1` and `acme` with any tenant slug that has `url_mode=subdomain`.)

### Switch a tenant to subdomain mode

1. Log in as a user with `tenant:write` permission
2. Navigate to **Settings → URL mode** (`/t/<slug>/settings/url-mode`)
3. Select **Subdomain** and enter the parent domain (e.g. `localhost`)
4. Save — a warning will appear: "Re-auth required after switch"
5. All existing sessions are invalidated; re-authenticate

### /etc/hosts entries (if needed)

For subdomains that are not `*.localhost`, you may need entries in `/etc/hosts`:

```
127.0.0.1  acme.myapp.local
127.0.0.1  beta.myapp.local
```

For `*.localhost`, most operating systems resolve these automatically without `/etc/hosts`
entries. If your OS does not, add:

```
127.0.0.1  acme.localhost
127.0.0.1  beta.localhost
```

## Tenant picker re-auth flow

When switching between tenants in subdomain mode:

- **Same parent domain**: session cookie is already scoped to `.localhost`, so the
  switch is seamless — navigate to the other subdomain, session is valid.
- **Different parent domains** or **path → subdomain switch**: user sees a confirmation
  modal ("you'll be logged out and need to re-auth on the subdomain") before the switch.

## Spec references

| Section | Content |
|---|---|
| §3 row 12 | Subdomain mode logic and activation |
| §4.3 | CSRF relaxation: `SameSite=Lax` + `Domain=<parent>` in subdomain mode |
| §8.4 | URL mode setting ownership (Plan 12, not Plan 7) |
| §10 | Risk: Vite proxy subdomain-aware config |
