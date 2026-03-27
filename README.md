# Netmap NG

Modern, interactive network weathermap with Observium integration, real-time traffic visualization, and AI-assisted topology layout.

A complete rewrite of [PHP Network Weathermap](https://github.com/howardjones/network-weathermap/) built for today's networks: mobile-friendly, dark NOC-inspired UI, drag-and-drop editor, and automatic topology discovery.

## Why Netmap NG?

The original PHP Weathermap generates static PNG images from config files. Netmap NG replaces this with an interactive web application:

- **Live canvas** instead of static images -- zoom, pan, tap on any link
- **Drag-and-drop editor** instead of editing text config files
- **Auto-discovery** from Observium's CDP/LLDP topology
- **AI-powered layout** -- describe what you want, Claude positions everything
- **Mobile-first** -- works on phones and tablets in the NOC

## Features

### Interactive Map
- Zoomable, pannable canvas powered by ReactFlow
- Touch gestures for mobile (pinch-to-zoom, drag)
- Click any link to see historical traffic graphs
- Minimap for navigation on large topologies

### Real-Time Traffic
- Color-coded links by utilization percentage (configurable scale)
- Live polling from Observium's `ports-state` table
- Bandwidth labels showing current in/out rates in bps
- Teal (inbound) / Amber (outbound) colorblind-safe palette

### Equipment Types
| Type | Badge | Color | Use case |
|------|-------|-------|----------|
| Router | `RTR` | Amber | Core/edge routers |
| Switch L3 | `L3` | Purple | Layer 3 switches |
| Switch L2 | `L2` | Blue | Access / distribution |
| Server | `SRV` | Green | Servers, hypervisors |
| Firewall | `FW` | Red | Security appliances |
| Cloud / IX | `IX` | Cyan | Internet exchanges |
| External | `EXT` | Pink | Transit, external connectivity |
| Group | `GRP` | Gray | Sites, racks, logical containers |

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

### Bandwidth Capacity
Links display their capacity (1G / 10G / 25G / 40G / 100G / 400G) and current utilization. Multiple connection points per node (N/S/E/W + 25%/75% offsets) prevent arrows from converging to the center.

### Grouping
Container nodes represent sites, racks, or logical groups. Child nodes are constrained within their parent, making it easy to visualize multi-site topologies.

### AI-Assisted Layout
Set `ANTHROPIC_API_KEY` and use the editor's "Generate with Claude":
1. Reads devices and CDP/LLDP neighbors from Observium
2. Detects equipment types from hardware/OS fields (Arista = switch, Cisco ASR = router, etc.)
3. Identifies link types from interface descriptions (transit / IX / PNI keywords)
4. Groups by site/location and generates optimized positions with proper anchor distribution

### Authentication
Pluggable OAuth2/OIDC authentication. Set `AUTH_DISABLED=true` for local development.

## Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │               Frontend (React)               │
                    │  ReactFlow canvas + Recharts + Zustand store │
                    └──────────────────┬───────────────────────────┘
                                       │ JSON / REST
                    ┌──────────────────┴───────────────────────────┐
                    │              Backend (FastAPI)                │
                    │  Maps CRUD │ Nodes │ Links │ AI │ Datasources│
                    └──┬────────────┬──────────────┬───────────────┘
                       │            │              │
                 ┌─────┴─────┐  ┌──┴───┐   ┌──────┴──────┐
                 │  SQLite   │  │ RRD  │   │  Observium  │
                 │ map config│  │files │   │  MySQL (RO) │
                 └───────────┘  └──────┘   └─────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite |
| Map engine | @xyflow/react (ReactFlow) |
| Charts | Recharts (area charts, teal/amber gradients) |
| Styling | Tailwind CSS, JetBrains Mono, NOC dark theme |
| State | Zustand |
| Backend | Python 3.12, FastAPI, SQLAlchemy async |
| App DB | SQLite |
| Monitoring data | Observium MySQL (read-only) + RRD files |
| Auth | OAuth2/OIDC via Authlib |
| AI layout | Claude API (Anthropic) |
| Infra | Docker Compose |

## Deployment

### Docker Compose (recommended)

```bash
git clone https://github.com/nextmap-io/netmap-ng.git
cd netmap-ng

# Configure
cp .env.example .env
# Edit .env:
#   - APP_SECRET_KEY (required, generate with: python -c "import secrets; print(secrets.token_urlsafe(32))")
#   - OBSERVIUM_DB_* (Observium MySQL connection)
#   - OAUTH_* (OAuth provider, or set AUTH_DISABLED=true)
#   - ANTHROPIC_API_KEY (optional, for AI layout)

docker compose up -d
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000 |
| API docs (Swagger) | http://localhost:8000/docs |

### Local Development

```bash
# Start Redis
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

## Data Sources

### Observium MySQL

The app reads directly from Observium's database (read-only):

| Table | Data |
|-------|------|
| `devices` | Equipment inventory (hostname, hardware, OS, location) |
| `ports` | Interface configuration (ifName, ifSpeed, ifAlias) |
| `ports-state` | Live traffic rates (ifInOctets_rate, ifOutOctets_rate, utilization %) |
| `neighbours` | CDP/LLDP topology (local port ↔ remote port) |

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

| Variable | Required | Description |
|----------|----------|-------------|
| `APP_SECRET_KEY` | Yes | Session signing key (min 16 chars) |
| `AUTH_DISABLED` | No | Set `true` for local dev without OAuth |
| `OAUTH_CLIENT_ID` | Prod | OAuth2 client ID |
| `OAUTH_CLIENT_SECRET` | Prod | OAuth2 client secret |
| `OAUTH_AUTHORIZE_URL` | Prod | OIDC authorization endpoint |
| `OAUTH_TOKEN_URL` | Prod | OIDC token endpoint |
| `OAUTH_USERINFO_URL` | Prod | OIDC userinfo endpoint |
| `OBSERVIUM_DB_HOST` | Yes | Observium MySQL host |
| `OBSERVIUM_DB_USER` | Yes | MySQL read-only user |
| `OBSERVIUM_DB_PASSWORD` | Yes | MySQL password |
| `OBSERVIUM_RRD_PATH` | No | Path to Observium RRD files |
| `ANTHROPIC_API_KEY` | No | For AI-assisted layout generation |
| `CORS_ORIGINS` | No | Comma-separated allowed origins |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code guidelines, and PR process.

## License

[MIT](LICENSE)
