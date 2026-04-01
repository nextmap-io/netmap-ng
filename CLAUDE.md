# Netmap NG

Modern network weathermap with Observium integration, real-time traffic visualization, and public map sharing. Replaces PHP Network Weathermap.

## Architecture

```
Observium MySQL ──► Backend (FastAPI) ──► Frontend (React + ReactFlow)
Observium RRD  ──►      │
                    SQLite (maps)
```

Python backend, React frontend in `frontend/`.

## Key Decisions

- **SQLite** for map configuration (nodes, links, positions) -- simple, no extra service needed.
- **Observium MySQL** (read-only) for live traffic data (`ports-state` table) and topology discovery (`neighbours` table via CDP/LLDP).
- **RRD files** for historical graphs -- read via `rrdtool xport` subprocess with strict path validation.
- **ReactFlow** (@xyflow/react) for interactive map canvas -- supports custom nodes, custom edges, grouping, zoom/pan/touch.
- **Zustand** for frontend state (not Redux -- simpler for this use case).
- **OIDC authentication** via Authlib with role-based access control (viewer/editor/admin via OIDC claims).
- **Authorization guards** on all API endpoints -- editor/admin roles enforced, map ownership checked.
- **Public maps** via unique token URLs with configurable data filtering (no sensitive data leaked).
- **Dark-first** NOC-inspired UI theme, JetBrains Mono with tabular numbers.

## Directory Map

| Path | Purpose |
|------|---------|
| `backend/app/main.py` | FastAPI app, middleware, route wiring |
| `backend/app/config.py` | Pydantic settings (env vars) |
| `backend/app/auth/oauth.py` | OIDC login/callback/session, `get_current_user` dependency |
| `backend/app/auth/guards.py` | Authorization guards: `require_editor`, `require_map_owner`, `require_map_read`, role checks |
| `backend/app/models/` | SQLAlchemy models: Map (with public_token, public_settings), Node (9 types), Link (7 types) |
| `backend/app/api/maps.py` | Maps CRUD + serialization |
| `backend/app/api/nodes.py` | Nodes CRUD + batch-move (drag & drop) |
| `backend/app/api/links.py` | Links CRUD |
| `backend/app/api/public.py` | Public map endpoints (unauthenticated) with data filtering |
| `backend/app/api/datasources.py` | Observium data + live traffic + RRD history endpoints |
| `backend/app/datasources/observium.py` | Raw MySQL queries against Observium (devices, ports, neighbours) |
| `backend/app/datasources/rrd.py` | RRD file reader with path traversal protection |
| `backend/app/services/` | Business logic services |
| `frontend/src/components/Map/MapView.tsx` | Main ReactFlow canvas, node/edge mapping |
| `frontend/src/components/Map/PublicMapView.tsx` | Public (unauthenticated) map viewer with filtered data |
| `frontend/src/components/Map/NetworkNode.tsx` | Custom node with type badge + distributed handles |
| `frontend/src/components/Map/NetworkLink.tsx` | Custom edge with split-gradient traffic labels + directional arrows |
| `frontend/src/components/Map/GroupNode.tsx` | Container node for sites/racks/logical groups |
| `frontend/src/components/Map/TrafficLegend.tsx` | Color scale legend overlay |
| `frontend/src/components/Graph/TrafficGraph.tsx` | Recharts bottom panel (teal in / amber out) |
| `frontend/src/components/Editor/MapEditor.tsx` | Editor sidebar panel |
| `frontend/src/components/Editor/PropertyPanel.tsx` | Node/link property editor |
| `frontend/src/components/Editor/NodeProperties.tsx` | Node-specific property fields |
| `frontend/src/components/Editor/LinkProperties.tsx` | Link-specific property fields |
| `frontend/src/components/Editor/LinkCreationDialog.tsx` | Dialog for creating links between nodes |
| `frontend/src/components/Editor/DevicePicker.tsx` | Observium device picker for node binding |
| `frontend/src/components/Editor/PortPicker.tsx` | Observium port picker for link binding |
| `frontend/src/components/Editor/EditorToolbar.tsx` | Toolbar with alignment/distribution tools |
| `frontend/src/components/Editor/EditorToolbox.tsx` | Node type palette for drag-to-create |
| `frontend/src/components/Editor/MapSettingsDialog.tsx` | Map settings: scales, refresh, public sharing |
| `frontend/src/components/Editor/DeleteConfirmDialog.tsx` | Confirmation dialog for destructive actions |
| `frontend/src/components/Layout/Header.tsx` | App header with theme toggle, auth status |
| `frontend/src/components/Layout/MapList.tsx` | Map listing/selection |
| `frontend/src/hooks/useMapStore.ts` | Zustand store: map data, traffic polling, edit state |
| `frontend/src/hooks/useObserviumData.ts` | Hook for fetching Observium device/port data |
| `frontend/src/hooks/useTheme.ts` | Theme management (light/dark/system/SCADA) |
| `frontend/src/api/client.ts` | Typed fetch wrapper with URL encoding |

## Authentication & Authorization

- **OIDC** via Authlib: supports Microsoft Entra ID, Keycloak, generic OIDC providers.
- **Roles**: viewer (default authenticated), editor (`OAUTH_EDITOR_ROLE`), admin (`OAUTH_ADMIN_ROLE`).
- **Guards** (`backend/app/auth/guards.py`):
  - `require_editor` -- user must have editor role for write operations.
  - `require_map_owner` -- user must own the map or be admin to modify it.
  - `require_map_read` -- user must own the map, be admin, or map must be public.
- **Public maps** (`backend/app/api/public.py`): unauthenticated endpoints at `/api/public/maps/{token}` that strip sensitive data (Observium bindings, device IDs, RRD paths).
- **Auth bypass**: `AUTH_DISABLED=true` for local development only, not silently disabled.

## Security

- **Path traversal protection** in `rrd.py`: regex validation on hostname/port_identifier + `os.path.realpath()` containment check.
- **Subprocess args validation**: `start`/`end` validated against regex, `resolution` bounded 60-86400.
- **Authorization guards** on all write endpoints; map ownership enforced.
- **Public API data filtering**: Observium bindings, device IDs, RRD paths, info URLs stripped from public responses.
- **Auth bypass requires explicit `AUTH_DISABLED=true`** -- not silently disabled when OAuth is unconfigured.
- **Session secret**: auto-generated if not set, minimum 16 chars enforced.
- **Session cookies**: `same_site=lax`, `https_only` auto-detected from `APP_BASE_URL`.
- **CORS**: configurable via `CORS_ORIGINS` env var, restricted methods/headers.
- **Security headers**: X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security.
- **Audit logging**: all write operations logged with user identity, map ID, action type.
- **Pydantic validation**: enums enforced (NodeType, LinkType), max_length on strings, bounded integers.

## Running

```bash
make docker-up          # Redis
make backend-dev        # Terminal 1
make frontend-dev       # Terminal 2
```

`make ci` runs all checks locally (Python lint/typecheck/test + frontend lint/typecheck/build).

## CI/CD

- **CI** (`.github/workflows/ci.yml`): lint (ruff), typecheck (mypy), test (pytest), frontend (eslint, tsc, vite build), Docker push to GHCR on `main`
- **Release** (`.github/workflows/release.yml`): manual dispatch or tag push -> Docker multi-arch, GitHub Release with changelog
- **Dependabot**: Python, npm, Docker, GitHub Actions (weekly)
- Docker images: `ghcr.io/<owner>/netmap-ng-{backend,frontend}`

## Code Conventions

- Python: `ruff` for linting and formatting, type hints on all functions
- Python: parameterized SQL only (asyncmy `%s` placeholders), never f-string SQL
- Python: all user input validated at API boundary via Pydantic with `Field(max_length=...)`, enum types
- Frontend: no `any` types -- typed API client with concrete interfaces
- Frontend: `encodeURIComponent()` on all URL path params, `URLSearchParams` for query strings
- Frontend: Zustand store for state, `loadMap()` for refresh (never `window.location.reload()`)
- Docker: slim base, no `--reload` in production
