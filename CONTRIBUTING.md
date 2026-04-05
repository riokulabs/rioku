# Contributing to Rioku

Thanks for your interest in contributing to Rioku! This document covers the process and conventions for contributing.

## Getting Started

1. Fork the repository
2. Create a feature branch from `develop` (`feat/my-feature`, `fix/my-bugfix`, etc.)
3. Make your changes
4. Open a pull request targeting `develop`

## Branch Naming

Use prefixed branch names:

- `feat/` — new features
- `fix/` — bug fixes
- `docs/` — documentation changes
- `chore/` — maintenance, dependencies, tooling
- `refactor/` — code restructuring without behavior changes
- `test/` — test additions or fixes
- `ci/` — CI/CD changes

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/). Every commit message must follow this format:

```text
type(scope): description

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`

Examples:
- `feat(cli): add rku policy attach command`
- `fix(store): handle Galera certification conflict retry`
- `docs(contrib): update testing guidelines`

## Pull Requests

- All PRs target `develop` (not `main`)
- PRs are squash merged — write a clean PR title in conventional commit format
- Fill out the PR template
- All CI checks must pass
- Commits must be signed

## Development Setup

### Prerequisites

- macOS or Linux
- [mise](https://mise.jdx.dev) (recommended) or manually install: Go 1.24+, Node.js 22+, buf, golangci-lint, cspell, git-cliff

### Quick Start

```bash
# Clone the repo
git clone https://github.com/riokulabs/rioku.git
cd rioku

# Set up everything (tools, hooks, dependencies)
make setup

# Build
make build-daemon

# Run tests
make test-race

# Generate proto code
make proto
```

`make setup` will install tools via mise (or check for them manually), set up git hooks, and download Go dependencies. Run it once after cloning.

## Code Style

- **Go**: Standard library preferred. No ORM. No external test libraries.
- **Tests**: Always run with `-race`. Table-driven tests. Real databases for integration tests.
- **Errors**: Handle every error explicitly. Never discard.
- See `contrib-docs/development/coding-guidelines.md` for full guidelines.

## Reporting Bugs

Use the [Bug Report](https://github.com/riokulabs/rioku/issues/new?template=bug_report.yml) issue template.

## Requesting Features

Use the [Feature Request](https://github.com/riokulabs/rioku/issues/new?template=feature_request.yml) issue template.

## License

By contributing to Rioku, you agree that your contributions will be licensed under the Apache License 2.0.
