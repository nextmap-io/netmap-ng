# Netmap NG

Modern network weathermap with Observium integration, real-time traffic visualization, and AI-assisted layout. Replaces PHP Network Weathermap.

## Architecture

```
Observium MySQL ──► Backend (FastAPI) ──► Frontend (React + ReactFlow)
Observium RRD  ──►      │
                    SQLite (maps)
```

Python backend, React frontend in `frontend/`.

## Key Decisions

- **SQLite** for map configuration (nodes, links, positions) — simple, no extra service needed.
- **Observium MySQL** (read-only) for live traffic data (`ports-state` table) and topology discovery (`neighbours` table via CDP/LLDP).
- **RRD files** for historical graphs — read via `rrdtool xport` subprocess with strict path validation.
- **ReactFlow** (@xyflow/react) for interactive map canvas — supports custom nodes, custom edges, grouping, zoom/pan/touch.
- **Zustand** for frontend state (not Redux — simpler for this use case).
- **OAuth2/OIDC** authentication via Authlib, explicitly opt-in disable via `AUTH_DISABLED=true`.
- **Claude API** for AI-assisted topology layout from Observium discovery data.
- **Dark-first** NOC-inspired UI theme, JetBrains Mono with tabular numbers (same design language as as-stats).

## Directory Map

| Path | Purpose |
|------|---------|
| `backend/app/main.py` | FastAPI app, middleware, route wiring |
| `backend/app/config.py` | Pydantic settings (env vars) |
| `backend/app/auth/oauth.py` | OAuth2 login/callback/session, `get_current_user` dependency |
| `backend/app/models/` | SQLAlchemy models: Map, Node (9 types), Link (8 types) |
| `backend/app/api/maps.py` | Maps CRUD + serialization |
| `backend/app/api/nodes.py` | Nodes CRUD + batch-move (drag & drop) |
| `backend/app/api/links.py` | Links CRUD |
| `backend/app/api/datasources.py` | Observium data + live traffic + RRD history endpoints |
| `backend/app/api/ai.py` | Claude-powered map layout generation |
| `backend/app/datasources/observium.py` | Raw MySQL queries against Observium (devices, ports, neighbours) |
| `backend/app/datasources/rrd.py` | RRD file reader with path traversal protection |
| `frontend/src/components/Map/MapView.tsx` | Main ReactFlow canvas, node/edge mapping |
| `frontend/src/components/Map/NetworkNode.tsx` | Custom node with type badge + distributed handles |
| `frontend/src/components/Map/NetworkLink.tsx` | Custom edge with traffic labels + type indicators |
| `frontend/src/components/Graph/TrafficGraph.tsx` | Recharts bottom panel (teal in / amber out) |
| `frontend/src/components/Editor/MapEditor.tsx` | Editor sidebar + AI generation |
| `frontend/src/hooks/useMapStore.ts` | Zustand store: map data, traffic polling, edit state |
| `frontend/src/api/client.ts` | Typed fetch wrapper with URL encoding |

## Security

- **Path traversal protection** in `rrd.py`: regex validation on hostname/port_identifier + `os.path.realpath()` containment check.
- **Subprocess args validation**: `start`/`end` validated against regex, `resolution` bounded 60-86400.
- **Auth bypass requires explicit `AUTH_DISABLED=true`** — not silently disabled when OAuth is unconfigured.
- **Session secret**: auto-generated if not set, minimum 16 chars enforced.
- **Session cookies**: `same_site=lax`, `https_only` auto-detected from `APP_BASE_URL`.
- **CORS**: configurable via `CORS_ORIGINS` env var, restricted methods/headers.
- **AI endpoint**: exceptions caught and logged, never leaks raw LLM output or API keys to client.
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
- **Release** (`.github/workflows/release.yml`): manual dispatch or tag push → Docker multi-arch, GitHub Release with changelog
- **Dependabot**: Python, npm, Docker, GitHub Actions (weekly)
- Docker images: `ghcr.io/<owner>/netmap-ng-{backend,frontend}`

## Code Conventions

- Python: `ruff` for linting and formatting, type hints on all functions
- Python: parameterized SQL only (asyncmy `%s` placeholders), never f-string SQL
- Python: all user input validated at API boundary via Pydantic with `Field(max_length=...)`, enum types
- Frontend: no `any` types — typed API client with concrete interfaces
- Frontend: `encodeURIComponent()` on all URL path params, `URLSearchParams` for query strings
- Frontend: Zustand store for state, `loadMap()` for refresh (never `window.location.reload()`)
- Docker: slim base, no `--reload` in production
