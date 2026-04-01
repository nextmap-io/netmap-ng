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

# Configure environment
cp .env.example .env
# Set AUTH_DISABLED=true in .env for local development without OIDC

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

### Authentication in Development

Set `AUTH_DISABLED=true` in your `.env` file for local development. This bypasses OIDC authentication and grants full access. Never use this in production.

When `AUTH_DISABLED=true`, all API requests are treated as coming from an authenticated admin user, so you can test all editor features without configuring an OIDC provider.

To test OIDC locally, configure a local Keycloak instance or use your organization's OIDC provider with `http://localhost:8000/auth/callback` as the redirect URI.

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
- Handle errors explicitly -- never let exceptions leak internal details

### TypeScript / React (Frontend)

- ESLint must pass (`npm run lint`)
- TypeScript strict mode -- avoid `any` types
- Use Zustand for state management
- Components in `components/`, hooks in `hooks/`, API client in `api/`
- JetBrains Mono + tabular-nums for all data display

### Docker

- Multi-stage builds where applicable
- Alpine or slim base images
- No `--reload` in production CMD

## Security

Working on security-sensitive code requires extra care. The following areas are security-critical:

### Authentication & Authorization

- **`backend/app/auth/oauth.py`**: OIDC login flow, session management, `get_current_user` dependency.
- **`backend/app/auth/guards.py`**: Authorization guards (`require_editor`, `require_map_owner`, `require_map_read`). All write endpoints must use these guards.
- When adding new API endpoints, always apply the appropriate guard as a FastAPI dependency.
- Never bypass authentication checks -- use `AUTH_DISABLED` only in development.

### Public API

- **`backend/app/api/public.py`**: Serves map data to unauthenticated users. Must strip all sensitive fields (Observium bindings, device IDs, RRD paths, info URLs).
- When adding new fields to nodes or links, review `_filter_node()` and `_filter_link()` to ensure sensitive data is not leaked through public endpoints.
- Public traffic endpoints must respect `public_settings` (show_bps, show_bandwidth).

### Data Validation

- All user input must be validated at the API boundary via Pydantic models.
- RRD file paths must pass regex validation and `os.path.realpath()` containment checks.
- SQL queries must use parameterized placeholders, never string interpolation.

### If You Find a Vulnerability

Please report security vulnerabilities privately via GitHub Security Advisories rather than opening a public issue.

## Architecture Overview

```
Frontend (React + Vite)        Backend (FastAPI)
+---------------------+        +----------------------+
|  ReactFlow canvas   |<------>|  REST API            |
|  Custom nodes/edges |  JSON  |  +-- Maps CRUD       |
|  Recharts graphs    |        |  +-- Nodes CRUD      |
|  Zustand store      |        |  +-- Links CRUD      |
|  Tailwind CSS       |        |  +-- Public API      |
|  PublicMapView      |        |  +-- Datasources     |
+---------------------+        +--Auth guards---------+
                               |  SQLite (map config)  |
                               |  MySQL (Observium RO) |
                               |  RRD files (history)  |
                               +----------------------+
```

### Backend Directory

| Directory / File | Purpose |
|------------------|---------|
| `backend/app/api/maps.py` | Maps CRUD + serialization |
| `backend/app/api/nodes.py` | Nodes CRUD + batch-move |
| `backend/app/api/links.py` | Links CRUD |
| `backend/app/api/public.py` | Public map endpoints (unauthenticated, filtered data) |
| `backend/app/api/datasources.py` | Observium data + live traffic + RRD history |
| `backend/app/auth/oauth.py` | OIDC login/callback/session management |
| `backend/app/auth/guards.py` | Authorization guards (require_editor, require_map_owner, require_map_read) |
| `backend/app/datasources/observium.py` | Raw MySQL queries against Observium |
| `backend/app/datasources/rrd.py` | RRD file reader with path traversal protection |
| `backend/app/models/` | SQLAlchemy models: Map, Node, Link |
| `backend/app/services/` | Business logic services |
| `backend/app/config.py` | Pydantic settings (env vars) |
| `backend/app/main.py` | FastAPI app, middleware, route wiring |

### Frontend Directory

| Directory / File | Purpose |
|------------------|---------|
| `frontend/src/components/Map/MapView.tsx` | Main ReactFlow canvas |
| `frontend/src/components/Map/PublicMapView.tsx` | Public (unauthenticated) map viewer |
| `frontend/src/components/Map/NetworkNode.tsx` | Custom node with type badge + handles |
| `frontend/src/components/Map/NetworkLink.tsx` | Custom edge with split-gradient traffic labels |
| `frontend/src/components/Map/GroupNode.tsx` | Container node for groups |
| `frontend/src/components/Map/TrafficLegend.tsx` | Color scale legend |
| `frontend/src/components/Graph/TrafficGraph.tsx` | Recharts traffic history panel |
| `frontend/src/components/Editor/MapEditor.tsx` | Editor sidebar |
| `frontend/src/components/Editor/PropertyPanel.tsx` | Node/link property editor |
| `frontend/src/components/Editor/NodeProperties.tsx` | Node property fields |
| `frontend/src/components/Editor/LinkProperties.tsx` | Link property fields |
| `frontend/src/components/Editor/LinkCreationDialog.tsx` | Link creation dialog |
| `frontend/src/components/Editor/DevicePicker.tsx` | Observium device picker |
| `frontend/src/components/Editor/PortPicker.tsx` | Observium port picker |
| `frontend/src/components/Editor/EditorToolbar.tsx` | Alignment/distribution tools |
| `frontend/src/components/Editor/EditorToolbox.tsx` | Node type palette |
| `frontend/src/components/Editor/MapSettingsDialog.tsx` | Map settings dialog |
| `frontend/src/components/Editor/DeleteConfirmDialog.tsx` | Delete confirmation |
| `frontend/src/components/Layout/Header.tsx` | App header |
| `frontend/src/components/Layout/MapList.tsx` | Map listing |
| `frontend/src/hooks/useMapStore.ts` | Zustand store |
| `frontend/src/hooks/useObserviumData.ts` | Observium data fetching |
| `frontend/src/hooks/useTheme.ts` | Theme management |
| `frontend/src/api/client.ts` | Typed API client |

## Review Process

- All PRs require at least 1 approving review
- CI must be green (lint, typecheck, test, build, Docker)
- Security-sensitive changes (auth, guards, public API) require extra scrutiny
- Squash merge into `main`
- Branch is auto-deleted after merge

## Need Help?

- Open a **Question** issue for help
- Check existing issues before creating new ones

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
