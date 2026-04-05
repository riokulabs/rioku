# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Rioku, please report it responsibly.

**Do not open a public issue.**

Email **security@rioku.dev** with:

- A description of the vulnerability
- Steps to reproduce (if possible)
- The affected version(s)
- Any potential impact assessment

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 7 days
- **Fix or mitigation**: Depends on severity, but we aim for 30 days for critical issues

## Scope

This policy covers the Rioku daemon, CLI, admin panel, first-party plugins, build service, and all code in the `riokulabs/rioku` repository.

Third-party plugins are not covered by this policy. Report vulnerabilities in third-party plugins directly to their maintainers.

## Supported Versions

Only the latest release is supported with security fixes. We do not backport fixes to older versions.

## Disclosure

We follow coordinated disclosure. Once a fix is released, we will publish a security advisory on GitHub with full details and credit to the reporter (unless they prefer to remain anonymous).
