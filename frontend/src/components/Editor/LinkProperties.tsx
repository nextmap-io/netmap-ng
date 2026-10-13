import { useState } from "react";
import type { MapLink, MapNode, LinkType, NodeType, ObserviumPort } from "@/types";
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from "@/types";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { PortPicker } from "./PortPicker";
import { BLOCK, BLOCK_TITLE, BUTTON_SM, BUTTON_DESTRUCTIVE, COLOR_INPUT, INPUT, LABEL, STACK } from "./ui";
import { parseBandwidth, formatBandwidthLabel } from "@/utils/bandwidth";
import { portSpeedBps } from "@/utils/portSpeed";

const BANDWIDTH_PRESETS = [100e6, 1e9, 2.5e9, 10e9, 25e9, 40e9, 100e9, 400e9];
/** Capacity a link gets at creation when nothing better is known. */
const DEFAULT_BANDWIDTH = 1e9;

const nodeCenter = (n: MapNode) => ({
  x: n.x + (n.width || DEFAULT_NODE_WIDTH) / 2,
  y: n.y + (n.height || DEFAULT_NODE_HEIGHT) / 2,
});

const LINK_TYPES: { value: LinkType; label: string }[] = [
  { value: "internal", label: "Internal" },
  { value: "transit", label: "Transit" },
  { value: "peering_ix", label: "Peering IX" },
  { value: "peering_pni", label: "Peering PNI" },
  { value: "customer", label: "Customer" },
  { value: "trunk", label: "Trunk" },
  { value: "lag", label: "LAG" },
  { value: "custom", label: "Custom" },
];

/** Node types are neutral and named by their word (docs/DESIGN.md). */
const NODE_TYPE_WORD: Record<NodeType, string> = {
  router: "Router", switch_l3: "Switch L3", switch_l2: "Switch L2", server: "Server",
  firewall: "Firewall", cloud: "Cloud", internet: "External",
  ix: "IX", transit: "Transit", pni: "PNI", provider: "Provider",
  customer: "Customer", group: "Group", label: "Label", custom: "Custom",
};

const inputClass = INPUT;

const labelClass = LABEL;

interface LinkPropertiesProps {
  link: MapLink;
  nodes: MapNode[];
  onUpdate: (fields: Record<string, unknown>) => void;
  onDelete: () => void;
}

export function LinkProperties({
  link,
  nodes,
  onUpdate,
  onDelete,
}: LinkPropertiesProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const sourceNode = nodes.find((n) => n.id === link.source_id);
  const targetNode = nodes.find((n) => n.id === link.target_id);

  // Free-text capacity support: presets from the dropdown, arbitrary values
  // (e.g. "2G", "500M") from the link creation dialog get a "Custom" field.
  const [customBandwidth, setCustomBandwidth] = useState(
    !BANDWIDTH_PRESETS.includes(link.bandwidth),
  );
  // Re-derive it when another link is shown or its capacity changes.
  const bandwidthKey = `${link.id}|${link.bandwidth}`;
  const [syncedBandwidthKey, setSyncedBandwidthKey] = useState(bandwidthKey);
  if (bandwidthKey !== syncedBandwidthKey) {
    setSyncedBandwidthKey(bandwidthKey);
    setCustomBandwidth(!BANDWIDTH_PRESETS.includes(link.bandwidth));
  }

  // Ports bound on each side, as resolved by the pickers — used to compare the
  // configured capacity with the real interface speed. The pickers re-report
  // whenever their bound port changes (including null on link switch/unbind).
  const [portA, setPortA] = useState<ObserviumPort | null>(null);
  const [portB, setPortB] = useState<ObserviumPort | null>(null);
  const detectedBps = portSpeedBps(portA) || portSpeedBps(portB);
  const capacityDiffers = detectedBps > 0 && detectedBps !== link.bandwidth;

  const bindPort = (side: "a" | "b", portId: number | null, port: ObserviumPort | null) => {
    const fields: Record<string, unknown> =
      side === "a" ? { observium_port_id_a: portId } : { observium_port_id_b: portId };
    // Only prefill capacity on the FIRST binding of a link still at the
    // creation default; anything else may be a deliberate value (e.g. a
    // committed rate below the port speed) and gets the one-click hint instead.
    const speed = portSpeedBps(port);
    const firstBinding = link.observium_port_id_a == null && link.observium_port_id_b == null;
    const defaultCapacity = link.bandwidth === DEFAULT_BANDWIDTH && link.bandwidth_label === "1G";
    if (portId != null && speed > 0 && firstBinding && defaultCapacity) {
      fields.bandwidth = speed;
      fields.bandwidth_label = formatBandwidthLabel(speed);
    }
    onUpdate(fields);
  };

  const viaPoints = Array.isArray(link.via_points) ? link.via_points : [];

  const addWaypoint = () => {
    if (!sourceNode || !targetNode) return;
    const a = nodeCenter(sourceNode);
    const b = nodeCenter(targetNode);
    // Midpoint, nudged perpendicular-ish so successive waypoints don't stack.
    const offset = 24 * (viaPoints.length + 1);
    const mid = { x: Math.round((a.x + b.x) / 2 + offset), y: Math.round((a.y + b.y) / 2 - offset) };
    onUpdate({ via_points: [...viaPoints, mid] });
  };

  return (
    <div className={STACK}>
      {/* IDENTITY */}
      <section className={BLOCK}>
        <h3 className={BLOCK_TITLE}>Identity</h3>
        <div className="space-y-2">
          <div>
            <label className={labelClass}>Name</label>
            <input
              type="text"
              value={link.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Type</label>
            <select
              value={link.link_type}
              onChange={(e) =>
                onUpdate({ link_type: e.target.value as LinkType })
              }
              className={inputClass}
            >
              {LINK_TYPES.map((lt) => (
                <option key={lt.value} value={lt.value}>
                  {lt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* ENDPOINTS */}
      <section className={BLOCK}>
        <h3 className={BLOCK_TITLE}>Endpoints</h3>
        <div className="space-y-2">
          <div>
            <label className={labelClass}>Source</label>
            <div className="flex items-baseline gap-2 px-2 py-1.5 bg-background rounded border border-border">
              {sourceNode && (
                <>
                  <span className="text-base text-foreground truncate">
                    {sourceNode.label || sourceNode.name}
                  </span>
                  <span className="ml-auto shrink-0 text-sm text-muted-foreground">
                    {NODE_TYPE_WORD[sourceNode.node_type] || "Custom"}
                  </span>
                </>
              )}
              {!sourceNode && (
                <span className="text-sm text-muted-foreground">Unknown</span>
              )}
            </div>
          </div>
          <div>
            <label className={labelClass}>Target</label>
            <div className="flex items-baseline gap-2 px-2 py-1.5 bg-background rounded border border-border">
              {targetNode && (
                <>
                  <span className="text-base text-foreground truncate">
                    {targetNode.label || targetNode.name}
                  </span>
                  <span className="ml-auto shrink-0 text-sm text-muted-foreground">
                    {NODE_TYPE_WORD[targetNode.node_type] || "Custom"}
                  </span>
                </>
              )}
              {!targetNode && (
                <span className="text-sm text-muted-foreground">Unknown</span>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div>
            <label className={labelClass}>Source anchor</label>
            <input
              type="text"
              value={link.source_anchor ?? ""}
              placeholder="auto"
              onChange={(e) => onUpdate({ source_anchor: e.target.value || null })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Target anchor</label>
            <input
              type="text"
              value={link.target_anchor ?? ""}
              placeholder="auto"
              onChange={(e) => onUpdate({ target_anchor: e.target.value || null })}
              className={inputClass}
            />
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Side and percent, e.g. E:90, W:10, N:50, S:25.
        </p>
      </section>

      {/* CAPACITY */}
      <section className={BLOCK}>
        <h3 className={BLOCK_TITLE}>Capacity</h3>
        <div className="space-y-2">
          <div>
            <label className={labelClass}>Bandwidth</label>
            <select
              value={customBandwidth ? "custom" : String(link.bandwidth)}
              onChange={(e) => {
                if (e.target.value === "custom") {
                  setCustomBandwidth(true);
                  return;
                }
                setCustomBandwidth(false);
                const bw = Number(e.target.value);
                onUpdate({ bandwidth: bw, bandwidth_label: formatBandwidthLabel(bw) });
              }}
              className={inputClass}
            >
              <option value={100e6}>100 Mbps</option>
              <option value={1e9}>1 Gbps</option>
              <option value={2.5e9}>2.5 Gbps</option>
              <option value={10e9}>10 Gbps</option>
              <option value={25e9}>25 Gbps</option>
              <option value={40e9}>40 Gbps</option>
              <option value={100e9}>100 Gbps</option>
              <option value={400e9}>400 Gbps</option>
              <option value="custom">Custom…</option>
            </select>
            {customBandwidth && (
              <input
                type="text"
                value={link.bandwidth_label}
                placeholder="e.g. 2G, 500M, 1.5T"
                onChange={(e) => {
                  const label = e.target.value;
                  onUpdate({ bandwidth_label: label, bandwidth: parseBandwidth(label) });
                }}
                className={`${inputClass} mt-1.5`}
              />
            )}
            {detectedBps > 0 && (
              <div className="flex items-center justify-between gap-2 mt-1">
                <span className="text-sm text-muted-foreground">
                  Port speed {formatBandwidthLabel(detectedBps)}
                  {!capacityDiffers && " (matches)"}
                </span>
                {capacityDiffers && (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdate({ bandwidth: detectedBps, bandwidth_label: formatBandwidthLabel(detectedBps) })
                    }
                    className={`${BUTTON_SM} whitespace-nowrap`}
                  >
                    Use port speed ({formatBandwidthLabel(detectedBps)})
                  </button>
                )}
              </div>
            )}
          </div>
          <div>
            <label className={labelClass}>Width</label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={20}
                value={link.width}
                onChange={(e) =>
                  onUpdate({ width: parseInt(e.target.value, 10) })
                }
                className="flex-1"
                style={{ accentColor: "var(--color-foreground)" }}
              />
              <span className="text-sm text-foreground-secondary w-6 text-right">
                {link.width}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* VISUAL */}
      <section className={BLOCK}>
        <h3 className={BLOCK_TITLE}>Visual</h3>
        <div className="space-y-2">
          <div>
            <label className={labelClass}>Label position</label>
            <select
              value={String(link.extra?.label_position || "above")}
              onChange={(e) =>
                onUpdate({ extra: { ...link.extra, label_position: e.target.value } })
              }
              className={inputClass}
            >
              <option value="above">Above</option>
              <option value="below">Below</option>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Routing</label>
            <select
              value={String(link.extra?.routing || "auto")}
              onChange={(e) =>
                onUpdate({ extra: { ...link.extra, routing: e.target.value } })
              }
              className={inputClass}
            >
              <option value="auto">Auto</option>
              <option value="straight">Straight</option>
              <option value="step">Right-angle (Step)</option>
              <option value="bezier">Curved (Bezier)</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Duplex</label>
            <select
              value={link.duplex}
              onChange={(e) =>
                onUpdate({ duplex: e.target.value as "full" | "half" })
              }
              className={inputClass}
            >
              <option value="full">Full</option>
              <option value="half">Half</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Line style</label>
            <select
              value={String(link.extra?.line_style || "auto")}
              onChange={(e) =>
                onUpdate({ extra: { ...link.extra, line_style: e.target.value } })
              }
              className={inputClass}
            >
              <option value="auto">Auto (from type)</option>
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Color override</label>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm text-foreground-secondary">
                <input
                  type="checkbox"
                  checked={!!link.extra?.color_override}
                  onChange={(e) =>
                    onUpdate({
                      extra: {
                        ...link.extra,
                        color_override: e.target.checked ? "#3b82f6" : undefined,
                      },
                    })
                  }
                  style={{ accentColor: "var(--color-foreground)" }}
                />
                Override
              </label>
              {!!link.extra?.color_override && (
                <input
                  type="color"
                  value={String(link.extra.color_override)}
                  onChange={(e) =>
                    onUpdate({ extra: { ...link.extra, color_override: e.target.value } })
                  }
                  className={COLOR_INPUT}
                />
              )}
            </div>
          </div>
          <div>
            <label className={labelClass}>Arrows</label>
            <select
              value={link.arrow_style === "none" ? "none" : "standard"}
              onChange={(e) => onUpdate({ arrow_style: e.target.value })}
              className={inputClass}
            >
              <option value="standard">Standard (in/out)</option>
              <option value="none">None</option>
            </select>
          </div>
        </div>
      </section>

      {/* WAYPOINTS */}
      <section className={BLOCK}>
        <h3 className={BLOCK_TITLE}>Waypoints</h3>
        <div className="space-y-2">
          <div>
            <label className={labelClass}>Waypoint style</label>
            <select
              value={link.via_style || "curved"}
              onChange={(e) => onUpdate({ via_style: e.target.value as "curved" | "angled" })}
              className={inputClass}
            >
              <option value="curved">Curved</option>
              <option value="angled">Angled (right angles)</option>
            </select>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              {viaPoints.length} waypoint{viaPoints.length === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={addWaypoint}
                disabled={!sourceNode || !targetNode}
                className={BUTTON_SM}
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => onUpdate({ via_points: [] })}
                disabled={viaPoints.length === 0}
                className={BUTTON_SM}
              >
                Clear
              </button>
            </div>
          </div>
          {viaPoints.length > 0 && (
            <div className="space-y-1">
              {viaPoints.map((p, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="text-sm text-muted-foreground w-4">{i + 1}</span>
                  <input
                    type="number"
                    value={Math.round(p.x)}
                    onChange={(e) => {
                      const next = viaPoints.map((q, j) => (j === i ? { ...q, x: Number(e.target.value) } : q));
                      onUpdate({ via_points: next });
                    }}
                    className={`${inputClass} w-20`}
                    title="X"
                  />
                  <input
                    type="number"
                    value={Math.round(p.y)}
                    onChange={(e) => {
                      const next = viaPoints.map((q, j) => (j === i ? { ...q, y: Number(e.target.value) } : q));
                      onUpdate({ via_points: next });
                    }}
                    className={`${inputClass} w-20`}
                    title="Y"
                  />
                  <button
                    type="button"
                    onClick={() => onUpdate({ via_points: viaPoints.filter((_, j) => j !== i) })}
                    className="w-7 h-7 inline-flex items-center justify-center rounded text-foreground-secondary hover:bg-muted hover:text-destructive transition-colors"
                    title="Remove waypoint"
                  >
                    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* DATASOURCE */}
      <section className={BLOCK}>
        <h3 className={BLOCK_TITLE}>Data source</h3>
        <PortPicker
          deviceId={sourceNode?.observium_device_id ?? null}
          value={link.observium_port_id_a}
          onChange={(portId, port) => bindPort("a", portId, port)}
          onPortResolved={setPortA}
          label="Port A"
        />
        <div className="mt-2" />
        <PortPicker
          deviceId={targetNode?.observium_device_id ?? null}
          value={link.observium_port_id_b}
          onChange={(portId, port) => bindPort("b", portId, port)}
          onPortResolved={setPortB}
          label="Port B"
        />
      </section>

      {/* URLS */}
      <section className={BLOCK}>
        <h3 className={BLOCK_TITLE}>URLs</h3>
        <div className="space-y-2">
          <div>
            <label className={labelClass}>In URL</label>
            <input
              type="text"
              value={link.info_url_in ?? ""}
              onChange={(e) =>
                onUpdate({ info_url_in: e.target.value || null })
              }
              className={inputClass}
              placeholder="https://..."
            />
          </div>
          <div>
            <label className={labelClass}>Out URL</label>
            <input
              type="text"
              value={link.info_url_out ?? ""}
              onChange={(e) =>
                onUpdate({ info_url_out: e.target.value || null })
              }
              className={inputClass}
              placeholder="https://..."
            />
          </div>
        </div>
      </section>

      {/* DELETE */}
      <section className={BLOCK}>
        <h3 className={BLOCK_TITLE}>Delete</h3>
        <button
          onClick={() => setConfirmDelete(true)}
          className={`${BUTTON_DESTRUCTIVE} w-full`}
        >
          Delete link
        </button>
      </section>

      <DeleteConfirmDialog
        open={confirmDelete}
        title="Delete link"
        message={`Are you sure you want to delete "${link.name}"? This action cannot be undone.`}
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
