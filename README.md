# Netmap NG

Modern, interactive network weathermap with Observium integration and real-time traffic visualization.

A complete rewrite of [PHP Network Weathermap](https://github.com/howardjones/network-weathermap/) built for today's networks: mobile-friendly, dark NOC-inspired UI, drag-and-drop editor, and public map sharing.

## Why Netmap NG?

The original PHP Weathermap generates static PNG images from config files. Netmap NG replaces this with an interactive web application:

- **Live canvas** instead of static images -- zoom, pan, tap on any link
- **Drag-and-drop editor** instead of editing text config files
- **Public map sharing** with configurable data visibility
- **OIDC authentication** with role-based access control
- **Mobile-first** -- works on phones and tablets in the NOC

## Features

### Interactive Map
- Zoomable, pannable canvas powered by ReactFlow
- Touch gestures for mobile (pinch-to-zoom, drag)
- Click any link to see historical traffic graphs
- Minimap for navigation on large topologies
- Split-gradient links with directional arrows (in/out)
- Light/dark/system theme + SCADA easter egg

### Real-Time Traffic
- Color-coded links by utilization percentage (configurable scale)
- Live polling from Observium's `ports-state` table
- Bandwidth labels showing current in/out rates in bps
- Configurable color scales with steps or gradient mode
- Configurable refresh interval

### Equipment Types
| Type | Badge | Color | Use case |
|------|-------|-------|----------|
| Router | `RTR` | Amber | Core/edge routers |
| Switch L3 | `L3` | Purple | Layer 3 switches |
| Switch L2 | `L2` | Blue | Access / distribution |
| Server | `SRV` | Green | Servers, hypervisors |
| Firewall | `FW` | Red | Security appliances |
| IX | `IX` | Cyan | Internet exchanges |
| Transit | `TR` | Pink | Transit providers |
| PNI | `PNI` | Teal | Private network interconnects |
| Provider | `PRV` | Orange | Service providers |

### Link Types
| Type | Visual | Use case |
|------|--------|----------|
| `internal` | Solid line | Backbone / internal |
| `transit` | Dashed + `TR` badge | Transit providers |
| `peering_ix` | Solid + `IX` badge | IX peering |
| `peering_pni` | Solid + `PNI` badge | Private peering |
| `customer` | Solid + `CX` badge | Customer links |
| `trunk` | Solid | L2 trunks |
| `lag` | Solid (aggregated) | LAG / Port-Channel |

### Map Editor
- Drag-and-drop node placement with snap-to-grid
- Property panel for editing node and link attributes
- Alignment and distribution tools (align left/right/top/bottom, distribute evenly)
- Link creation via drag-to-connect or link creation dialog
- Observium device picker for binding nodes to monitored devices
- Observium port picker for binding links to monitored interfaces
- Map settings dialog: color scales (steps or gradient mode), refresh interval, public sharing
- Delete confirmation dialog with keyboard shortcut support

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `Delete` / `Backspace` | Delete selected elements |
| `Escape` | Deselect all |
| `Ctrl+A` / `Cmd+A` | Select all |
| `Shift+Click` | Multi-select |

### Public Map Sharing
- Share maps via unique public token URL
- Configurable data visibility per map (hide bps, show percentage only)
- Sensitive data (Observium bindings, RRD paths, device IDs) automatically filtered
- No authentication required for public map viewers

### Authentication & Authorization
- OIDC authentication (Microsoft Entra ID, Keycloak, or any generic OIDC provider)
- Role-based access control: viewer, editor, admin (via OIDC claims)
- Authorization guards on all API endpoints
- `AUTH_DISABLED=true` for local development

## Architecture

```
                    +----------------------------------------------+
                    |               Frontend (React)               |
                    |  ReactFlow canvas + Recharts + Zustand store |
                    +------------------+---------------------------+
                                       | JSON / REST
                    +------------------+---------------------------+
                    |              Backend (FastAPI)                |
                    |  Maps CRUD | Nodes | Links | Public | Auth   |
                    +--+------------+--+-------------+-------------+
                       |            |  |             |
                 +-----+-----+  +--+--++   +---------+--------+
                 |  SQLite   |  | RRD  |   |  Observium       |
                 | map config|  |files |   |  MySQL (RO)      |
                 +-----------+  +------+   +------------------+
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite |
| Map engine | @xyflow/react (ReactFlow) |
| Charts | Recharts |
| Styling | Tailwind CSS, JetBrains Mono |
| State | Zustand |
| Backend | Python 3.12, FastAPI |
| App DB | SQLite (SQLAlchemy async) |
| Monitoring | Observium MySQL (read-only) + RRD files |
| Auth | OIDC (Authlib) - Entra ID, Keycloak |
| Infra | Docker Compose / systemd |

## Deployment

### Docker Compose (recommended for new installs)

```bash
git clone https://github.com/nextmap-io/netmap-ng.git
cd netmap-ng

# Configure
cp .env.example .env
# Edit .env:
#   - APP_SECRET_KEY (required, generate with: python -c "import secrets; print(secrets.token_urlsafe(32))")
#   - OBSERVIUM_DB_* (Observium MySQL connection)
#   - OAUTH_* (OIDC provider settings)

# Production (pre-built images from GHCR)
docker compose -f docker-compose.prod.yml up -d

# Development (local builds with live reload)
docker compose up -d
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 (prod) / http://localhost:5173 (dev) |
| Backend API | http://localhost:8000 |
| API docs (Swagger) | http://localhost:8000/docs |

### Native Install (for existing Observium servers)

If you already run Observium on a server, you can install Netmap NG alongside it:

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# Run with systemd or supervisor:
uvicorn app.main:app --host 0.0.0.0 --port 8000

# Frontend (build static files)
cd frontend && npm ci && npm run build
# Serve dist/ with nginx or caddy
```

### Local Development

```bash
# Start infrastructure (Redis)
make docker-up

# Backend (terminal 1)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
make backend-dev

# Frontend (terminal 2)
cd frontend && npm ci
make frontend-dev
```

### CI Checks

```bash
# Run everything the CI runs, locally
make ci
```

This runs: `ruff check` + `mypy` + `pytest` (backend) and `eslint` + `tsc` + `vite build` (frontend).

## Security

### Authentication
- OIDC authentication required by default for all API endpoints
- Supports Microsoft Entra ID, Keycloak, and any generic OIDC provider
- Session-based with secure cookies (`same_site=lax`, `https_only` auto-detected)
- Auth bypass requires explicit `AUTH_DISABLED=true` -- not silently disabled when OAuth is unconfigured

### Role-Based Access Control
- **Viewer**: can view maps they have access to (authenticated users)
- **Editor**: can create and edit maps (requires `OAUTH_EDITOR_ROLE` claim)
- **Admin**: full access to all maps (requires `OAUTH_ADMIN_ROLE` claim)
- Roles are read from the OIDC token claim specified by `OAUTH_ROLES_CLAIM`

### Authorization Guards
- All write endpoints require editor or admin role
- Map ownership enforced -- editors can only modify their own maps
- Admins can modify any map
- Public API endpoints serve filtered data with no authentication required

### Public Maps
- Maps can be shared via unique public token URL
- Configurable data filtering per map (show/hide bps, show percentage only)
- Sensitive data automatically stripped: Observium bindings, device IDs, RRD paths, info URLs

### Security Headers
- `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`
- CORS configurable via `CORS_ORIGINS` environment variable

### Audit Logging
- All write operations (create, update, delete) are logged with user identity
- Logs include map ID, action type, and timestamp

### Input Validation
- Path traversal protection in RRD file reader
- Parameterized SQL only (never string interpolation)
- Pydantic validation with enums, max_length, and bounded integers on all API inputs
- `encodeURIComponent()` on all frontend URL parameters

## Data Sources

### Observium MySQL

The app reads directly from Observium's database (read-only):

| Table | Data |
|-------|------|
| `devices` | Equipment inventory (hostname, hardware, OS, location) |
| `ports` | Interface configuration (ifName, ifSpeed, ifAlias) |
| `ports-state` | Live traffic rates (ifInOctets_rate, ifOutOctets_rate, utilization %) |
| `neighbours` | CDP/LLDP topology (local port - remote port) |

Create a read-only MySQL user on your Observium server:

```sql
CREATE USER 'netmap_ro'@'%' IDENTIFIED BY '<password>';
GRANT SELECT ON observium.devices TO 'netmap_ro'@'%';
GRANT SELECT ON observium.ports TO 'netmap_ro'@'%';
GRANT SELECT ON observium.`ports-state` TO 'netmap_ro'@'%';
GRANT SELECT ON observium.neighbours TO 'netmap_ro'@'%';
FLUSH PRIVILEGES;
```

### RRD Files

For historical traffic graphs, mount Observium's RRD directory into the backend container:

```yaml
# docker-compose.yml
services:
  backend:
    volumes:
      - /opt/observium/rrd:/rrd:ro
    environment:
      - OBSERVIUM_RRD_PATH=/rrd
```

Files follow the pattern `/rrd/<hostname>/port-<ifIndex>.rrd` with data sources `INOCTETS` and `OUTOCTETS` (DERIVE type, bytes/sec).

## Configuration

All configuration is via environment variables (see [`.env.example`](.env.example)):

### Application

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `APP_SECRET_KEY` | Yes | -- | Session signing key (min 16 chars). Generate with: `python -c "import secrets; print(secrets.token_urlsafe(32))"` |
| `APP_BASE_URL` | No | `http://localhost:8000` | Public URL of the backend (used for OAuth callbacks, secure cookies) |
| `AUTH_DISABLED` | No | `false` | Set `true` for local development without OIDC |
| `CORS_ORIGINS` | No | `http://localhost:5173,http://localhost:3000` | Comma-separated allowed origins |
| `APP_DB_URL` | No | `sqlite+aiosqlite:///./netmap.db` | SQLAlchemy database URL for map storage |

### OIDC Authentication

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OAUTH_CLIENT_ID` | Prod | -- | OIDC client ID from your identity provider |
| `OAUTH_CLIENT_SECRET` | Prod | -- | OIDC client secret |
| `OAUTH_AUTHORIZE_URL` | Prod | -- | OIDC authorization endpoint |
| `OAUTH_TOKEN_URL` | Prod | -- | OIDC token endpoint |
| `OAUTH_USERINFO_URL` | Prod | -- | OIDC userinfo endpoint |
| `OAUTH_SCOPES` | No | `openid profile email` | OIDC scopes to request |

### OIDC Roles

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OAUTH_EDITOR_ROLE` | No | -- | Role claim value required for editor access. Leave empty to allow all authenticated users to edit. |
| `OAUTH_ADMIN_ROLE` | No | -- | Role claim value required for admin access. Leave empty for no admin role enforcement. |
| `OAUTH_ROLES_CLAIM` | No | `roles` | Name of the claim in the OIDC token that contains user roles |

### Observium

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OBSERVIUM_DB_HOST` | Yes | -- | Observium MySQL server hostname |
| `OBSERVIUM_DB_PORT` | No | `3306` | Observium MySQL server port |
| `OBSERVIUM_DB_USER` | Yes | -- | MySQL read-only user |
| `OBSERVIUM_DB_PASSWORD` | Yes | -- | MySQL password |
| `OBSERVIUM_DB_NAME` | No | `observium` | Observium database name |
| `OBSERVIUM_RRD_PATH` | No | `/opt/observium/rrd` | Path to Observium RRD files (mount into container) |

## Disclaimer

Netmap NG is an independent open-source project. It is **not affiliated with, endorsed by, or associated with** [Observium](https://www.observium.org/) or its team. Observium is a registered trademark of its respective owners. Netmap NG merely reads data from Observium's database in a read-only manner, similar to how any third-party tool might integrate with a monitoring platform.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code guidelines, and PR process.

## License

[MIT](LICENSE)
