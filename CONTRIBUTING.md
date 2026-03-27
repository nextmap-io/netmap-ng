# Contributing to Netmap NG

Thanks for your interest in contributing! This guide will help you get started.

## Getting Started

### Prerequisites

- Python 3.12+
- Node.js 22+
- Docker and Docker Compose

### Development Setup

```bash
# Clone the repository
git clone https://github.com/nextmap-io/netmap-ng.git
cd netmap-ng

# Start infrastructure (Redis)
make docker-up

# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd ..

# Frontend
cd frontend && npm ci && cd ..

# Run everything
make backend-dev    # Terminal 1
make frontend-dev   # Terminal 2
```

The UI is at http://localhost:5173, the API at http://localhost:8000, API docs at http://localhost:8000/docs.

### Running Tests

```bash
# Backend lint + typecheck + test
make backend-lint
make backend-typecheck
make backend-test

# Frontend lint + typecheck + build
make frontend-lint
make frontend-typecheck
make frontend-build

# Run all CI checks locally
make ci
```

## How to Contribute

### Reporting Bugs

Open an issue using the **Bug Report** template. Include:

- Steps to reproduce
- Expected vs actual behavior
- Observium version if relevant
- Browser + OS for frontend issues

### Suggesting Features

Open an issue using the **Feature Request** template. Describe:

- The use case (what problem does it solve?)
- Proposed behavior
- Alternatives you've considered

### Submitting Code

1. **Fork** the repository
2. **Create a branch** from `main`: `git checkout -b feat/my-feature`
3. **Make your changes** following the guidelines below
4. **Test**: `make ci` must pass
5. **Commit** with a clear message (see Commit Messages below)
6. **Push** and open a **Pull Request** against `main`

### Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feat/short-description` | `feat/snmp-direct-polling` |
| Bug fix | `fix/short-description` | `fix/rrd-path-traversal` |
| Docs | `docs/short-description` | `docs/observium-setup` |
| Refactor | `refactor/short-description` | `refactor/datasource-plugins` |

### Commit Messages

Use clear, imperative-mood messages:

```
Add Observium API datasource support

Implement REST API client for Observium Subscription Edition
as an alternative to direct MySQL access. Supports device,
port, and neighbour endpoints.
```

- First line: concise summary (50 chars max, imperative mood)
- Blank line, then optional body with context
- Reference issues: `Fixes #42` or `Closes #42`

## Code Guidelines

### Python (Backend)

- Format with `ruff format`, lint with `ruff check`
- Type hints on all function signatures
- Use `async` functions for database and API operations
- Parameterized SQL only (never string concatenation for queries)
- Validate all user input at the API boundary (Pydantic models)
- Handle errors explicitly — never let exceptions leak internal details

### TypeScript / React (Frontend)

- ESLint must pass (`npm run lint`)
- TypeScript strict mode — avoid `any` types
- Use Zustand for state management
- Components in `components/`, hooks in `hooks/`, API client in `api/`
- JetBrains Mono + tabular-nums for all data display

### Docker

- Multi-stage builds where applicable
- Alpine or slim base images
- No `--reload` in production CMD

## Architecture Overview

```
Frontend (React + Vite)        Backend (FastAPI)
┌─────────────────────┐        ┌──────────────────────┐
│  ReactFlow canvas   │◄──────►│  REST API            │
│  Custom nodes/edges │  JSON  │  ├── Maps CRUD       │
│  Recharts graphs    │        │  ├── Nodes CRUD      │
│  Zustand store      │        │  ├── Links CRUD      │
│  Tailwind CSS       │        │  ├── Datasources     │
└─────────────────────┘        │  └── AI layout       │
                               ├──────────────────────┤
                               │  SQLite (map config)  │
                               │  MySQL (Observium RO) │
                               │  RRD files (history)  │
                               └──────────────────────┘
```

| Directory | Purpose |
|-----------|---------|
| `backend/app/api/` | FastAPI route handlers |
| `backend/app/auth/` | OAuth2/OIDC authentication |
| `backend/app/datasources/` | Observium MySQL + RRD file readers |
| `backend/app/models/` | SQLAlchemy models (Map, Node, Link) |
| `frontend/src/components/Map/` | ReactFlow canvas + custom nodes/edges |
| `frontend/src/components/Graph/` | Recharts traffic history |
| `frontend/src/components/Editor/` | Map editor panel + AI generation |
| `frontend/src/hooks/` | Zustand store |
| `frontend/src/api/` | Typed API client |

## Review Process

- All PRs require at least 1 approving review
- CI must be green (lint, typecheck, test, build, Docker)
- Squash merge into `main`
- Branch is auto-deleted after merge

## Need Help?

- Open a **Question** issue for help
- Check existing issues before creating new ones

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
