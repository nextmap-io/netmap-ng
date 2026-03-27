"""
AI-assisted map generation using Claude.
Given a set of Observium devices, Claude can:
- Discover topology from neighbours
- Choose appropriate node types (router/switch/server)
- Create logical grouping by site/rack
- Position nodes with proper layout
- Create links with correct bandwidth
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from app.auth.oauth import get_current_user
from app.config import get_settings
from app.datasources import observium

logger = logging.getLogger("netmap.ai")
router = APIRouter(prefix="/api/ai", tags=["ai"])


class GenerateMapRequest(BaseModel):
    device_ids: list[int] = Field(default_factory=list, max_length=200)
    instructions: str = Field("", max_length=2000)
    map_id: str | None = None


@router.post("/generate-map")
async def generate_map(data: GenerateMapRequest, user=Depends(get_current_user)):
    """
    Use Claude to generate or update a map layout from Observium data.
    """
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise HTTPException(503, "AI layout not available: ANTHROPIC_API_KEY not configured")

    # Gather Observium data
    devices = await observium.get_devices(data.device_ids or None)
    neighbours = await observium.get_neighbours(data.device_ids or None)

    # Gather port info per device for bandwidth detection
    device_ports = {}
    for dev in devices:
        ports = await observium.get_device_ports(dev["device_id"])
        device_ports[dev["device_id"]] = ports

    # Build context for Claude
    topology_context = _build_topology_context(devices, neighbours, device_ports)

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

        system_prompt = """You are a network topology layout engine. Given network devices and their
interconnections (from CDP/LLDP discovery), generate a weathermap layout.

You must return valid JSON with this structure:
{
  "nodes": [
    {
      "name": "device-hostname",
      "label": "Short Label",
      "node_type": "router|switch_l2|switch_l3|server|firewall|cloud|internet",
      "x": 500,
      "y": 300,
      "parent_group": "site-name or null",
      "observium_device_id": 123
    }
  ],
  "groups": [
    {
      "name": "PAR3",
      "label": "Paris - Equinix PA3",
      "x": 100,
      "y": 100,
      "width": 800,
      "height": 600
    }
  ],
  "links": [
    {
      "name": "link-name",
      "link_type": "internal|transit|peering_ix|peering_pni|trunk",
      "source": "device-a",
      "target": "device-b",
      "bandwidth": 10000000000,
      "bandwidth_label": "10G",
      "source_anchor": "E",
      "target_anchor": "W",
      "observium_port_id_a": 456,
      "observium_port_id_b": 789,
      "extra": {"provider": "Cogent", "interface_a": "Et49", "interface_b": "Et49"}
    }
  ]
}

Layout rules:
- Group devices by site/location when possible
- Routers at the top, core switches in the middle, access/servers at bottom
- External connections (IX, transit, PNI) on the sides or top
- Distribute link anchors on equipment blocks (N/S/E/W + offsets) so arrows don't all converge to the center
- Use ifAlias/ifDescr to detect link types (transit, IX, PNI keywords)
- Detect equipment type from hardware/OS fields (Arista=switch, Cisco ASR/XR=router, etc.)
- Infer bandwidth from ifSpeed/ifHighSpeed
- Canvas target: 1920x1080, nodes spaced ~150px apart minimum
"""

        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=8192,
            system=system_prompt,
            messages=[{
                "role": "user",
                "content": f"Generate a network weathermap layout for this topology:\n\n{topology_context}\n\nAdditional instructions: {data.instructions or 'Auto-layout based on topology.'}",
            }],
        )

        text_block = next(b for b in response.content if hasattr(b, "text"))
        response_text = text_block.text  # type: ignore[union-attr]

    except Exception:
        logger.exception("Claude API call failed")
        raise HTTPException(502, "AI layout generation failed. Check server logs.")

    # Extract JSON from response (handle markdown code blocks)
    if "```json" in response_text:
        response_text = response_text.split("```json")[1].split("```")[0]
    elif "```" in response_text:
        response_text = response_text.split("```")[1].split("```")[0]

    try:
        layout = json.loads(response_text.strip())
    except json.JSONDecodeError:
        logger.error("Failed to parse AI response: %s", response_text[:500])
        raise HTTPException(502, "AI returned an invalid layout. Try again or adjust instructions.")

    return layout


def _build_topology_context(devices, neighbours, device_ports) -> str:
    lines = ["# Devices"]
    for dev in devices:
        lines.append(f"- {dev['hostname']} (id={dev['device_id']}, hw={dev.get('hardware','?')}, os={dev.get('os','?')}, location={dev.get('location','?')})")
        ports = device_ports.get(dev["device_id"], [])
        interesting_ports = [p for p in ports if p.get("ifOperStatus") == "up" and p.get("ifSpeed", 0) >= 1_000_000_000]
        if interesting_ports:
            for p in interesting_ports[:30]:
                speed_g = (p.get("ifHighSpeed") or (p.get("ifSpeed", 0) / 1_000_000)) / 1000
                lines.append(f"  - port_id={p['port_id']} {p.get('ifName','?')} ({speed_g:.0f}G) alias=\"{p.get('ifAlias','')}\" in={p.get('ifInOctets_rate',0):.0f}B/s out={p.get('ifOutOctets_rate',0):.0f}B/s")

    lines.append("\n# CDP/LLDP Links")
    for n in neighbours:
        lines.append(f"- {n['local_hostname']}:{n.get('local_port','?')} <-> {n.get('remote_hostname','?')}:{n.get('remote_port','?')} (protocol={n['protocol']}, speed={n.get('local_port_speed',0)})")

    return "\n".join(lines)
