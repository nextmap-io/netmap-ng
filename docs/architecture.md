# Architecture

## Data Model

### Map
Top-level container. Stores canvas dimensions, scale definitions (color bands), and global settings.

### Node
Represents a network device or logical group on the map.
- **Position**: absolute (x, y) or contained within a parent group node
- **Type**: router, switch_l2, switch_l3, server, firewall, cloud, internet, group
- **Observium binding**: optional `observium_device_id` to link to a real device
- **Anchors**: multiple handles (N, S, E, W + offsets at 25%/75%) for distributing connections

### Link
Represents a connection between two nodes.
- **Endpoints**: source_id + target_id with optional anchor specifiers
- **Bandwidth**: capacity in bps + human label (1G, 10G, 100G...)
- **Type**: internal, transit, peering_ix, peering_pni, customer, trunk, lag
- **Datasource**: binding to traffic data (Observium port, RRD file, or static)
- **Via points**: intermediate routing points for curved/angled paths

### Scale
Color bands mapping utilization percentage to colors:
```
0%       -> grey    (#c0c0c0)
0-10%    -> blue    (#3366ff)
10-50%   -> cyan    (#66ccff)
50-90%   -> orange  (#ffaa00)
90-100%  -> red     (#ff3300)
```

## Data Flow

```
Observium MySQL ──► Backend API ──► Frontend Store ──► ReactFlow Canvas
     │                  │                                     │
     │              SQLite DB                                 │
     │            (map configs)                               │
     │                                                        │
Observium RRD ──► rrdtool xport ──► /api/traffic/history ──► Recharts
```

### Real-time traffic refresh
1. Frontend polls `/api/datasources/traffic/live?map_id=X` every N seconds
2. Backend queries Observium `ports-state` table for all ports referenced in the map
3. Returns `{link_id: {in_bps, out_bps, in_pct, out_pct}}`
4. Frontend updates edge colors based on scale lookup

### Historical graphs
1. User clicks a link edge
2. Frontend calls `/api/datasources/traffic/history?hostname=X&port_identifier=Y`
3. Backend runs `rrdtool xport` on the corresponding RRD file
4. Returns time series data rendered by Recharts in a bottom panel

## AI Layout Generation

1. User triggers "Generate with Claude" from editor
2. Backend fetches from Observium:
   - All devices (hostname, hardware, OS, location)
   - All ports with rates (ifName, ifSpeed, ifAlias)
   - All CDP/LLDP neighbours (topology)
3. Builds a text description of the topology
4. Sends to Claude with a structured prompt asking for JSON layout
5. Claude returns nodes (with types, positions, groups) and links (with types, anchors, bandwidth)
6. Backend saves to SQLite, frontend refreshes

## Anchor Distribution Strategy

To avoid all arrows converging to the center of a node, each node exposes
multiple connection handles:

```
     N:25    N    N:75
       ┌─────────────┐
W:25 ──┤             ├── E:25
   W ──┤    NODE     ├── E
W:75 ──┤             ├── E:75
       └─────────────┘
     S:25    S    S:75
```

When multiple links connect to the same node, the AI or manual editor assigns
different anchors (e.g., `E:25`, `E`, `E:75`) to spread the arrows vertically.

## Authentication Flow

```
Browser ──► /auth/login ──► OAuth Provider
                                  │
Browser ◄── /auth/callback ◄──────┘
    │
    │  (session cookie set)
    │
Browser ──► /api/* (with cookie) ──► Backend validates session
```

When `OAUTH_CLIENT_ID` is not set, auth is disabled and a local user is assumed.

## File Structure

```
netmap-ng/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app + middleware
│   │   ├── config.py            # Pydantic settings
│   │   ├── auth/oauth.py        # OAuth2 login/callback/session
│   │   ├── models/
│   │   │   ├── database.py      # SQLAlchemy async engine
│   │   │   ├── map.py           # Map model
│   │   │   ├── node.py          # Node model + types
│   │   │   └── link.py          # Link model + types
│   │   ├── api/
│   │   │   ├── maps.py          # Maps CRUD
│   │   │   ├── nodes.py         # Nodes CRUD + batch move
│   │   │   ├── links.py         # Links CRUD
│   │   │   ├── datasources.py   # Observium + RRD data endpoints
│   │   │   └── ai.py            # Claude-powered layout generation
│   │   └── datasources/
│   │       ├── observium.py     # Observium MySQL queries
│   │       └── rrd.py           # RRD file reading
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.tsx              # Routes
│   │   ├── main.tsx             # Entry point
│   │   ├── types/index.ts       # TypeScript types
│   │   ├── api/client.ts        # API client
│   │   ├── hooks/useMapStore.ts # Zustand store
│   │   └── components/
│   │       ├── Map/
│   │       │   ├── MapView.tsx      # Main ReactFlow canvas
│   │       │   ├── NetworkNode.tsx  # Custom node component
│   │       │   ├── GroupNode.tsx    # Group/site container
│   │       │   ├── NetworkLink.tsx  # Custom edge with traffic
│   │       │   └── TrafficLegend.tsx
│   │       ├── Graph/
│   │       │   └── TrafficGraph.tsx # Historical traffic chart
│   │       ├── Editor/
│   │       │   └── MapEditor.tsx    # Edit panel + AI generation
│   │       └── Layout/
│   │           ├── Header.tsx
│   │           └── MapList.tsx
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```
