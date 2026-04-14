import { useState } from "react";
import type { MapLink, MapNode, LinkType, NodeType } from "@/types";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { PortPicker } from "./PortPicker";

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

const NODE_ICONS: Record<NodeType, string> = {
  router: "RTR", switch_l3: "L3", switch_l2: "L2", server: "SRV",
  firewall: "FW", cloud: "CLD", internet: "NET",
  ix: "IX", transit: "TR", pni: "PNI", provider: "PRV",
  customer: "CST", group: "GRP", label: "TXT", custom: "---",
};

const NODE_BADGE_BG: Record<NodeType, string> = {
  router: "bg-node-router/20 text-node-router",
  switch_l3: "bg-node-switch-l3/20 text-node-switch-l3",
  switch_l2: "bg-node-switch-l2/20 text-node-switch-l2",
  server: "bg-node-server/20 text-node-server",
  firewall: "bg-node-firewall/20 text-node-firewall",
  cloud: "bg-node-cloud/20 text-node-cloud",
  internet: "bg-node-internet/20 text-node-internet",
  ix: "bg-[hsl(280,60%,55%)]/20 text-[hsl(280,60%,55%)]",
  transit: "bg-node-internet/20 text-node-internet",
  pni: "bg-[hsl(160,60%,45%)]/20 text-[hsl(160,60%,45%)]",
  provider: "bg-node-cloud/20 text-node-cloud",
  customer: "bg-node-customer/20 text-node-customer",
  group: "bg-noc-muted/20 text-noc-text-muted",
  label: "bg-transparent text-noc-text-muted",
  custom: "bg-noc-muted/20 text-noc-text-muted",
};

const inputClass =
  "w-full bg-noc-bg text-xs text-noc-text rounded border border-noc-border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent/50";

const labelClass = "noc-label mb-1";

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

  return (
    <div className="space-y-4">
      {/* IDENTITY */}
      <section>
        <div className={labelClass}>Identity</div>
        <div className="h-px bg-noc-border/50 mb-3" />
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
      <section>
        <div className={labelClass}>Endpoints</div>
        <div className="h-px bg-noc-border/50 mb-3" />
        <div className="space-y-2">
          <div>
            <label className={labelClass}>Source</label>
            <div className="flex items-center gap-1.5 px-2 py-1.5 bg-noc-bg rounded border border-noc-border">
              {sourceNode && (
                <>
                  <span
                    className={`text-2xs font-semibold rounded px-1 py-px leading-tight tracking-wider ${
                      NODE_BADGE_BG[sourceNode.node_type] || NODE_BADGE_BG.custom
                    }`}
                  >
                    {NODE_ICONS[sourceNode.node_type] || "---"}
                  </span>
                  <span className="text-2xs text-noc-text truncate">
                    {sourceNode.label || sourceNode.name}
                  </span>
                </>
              )}
              {!sourceNode && (
                <span className="text-2xs text-noc-text-dim">Unknown</span>
              )}
            </div>
          </div>
          <div>
            <label className={labelClass}>Target</label>
            <div className="flex items-center gap-1.5 px-2 py-1.5 bg-noc-bg rounded border border-noc-border">
              {targetNode && (
                <>
                  <span
                    className={`text-2xs font-semibold rounded px-1 py-px leading-tight tracking-wider ${
                      NODE_BADGE_BG[targetNode.node_type] || NODE_BADGE_BG.custom
                    }`}
                  >
                    {NODE_ICONS[targetNode.node_type] || "---"}
                  </span>
                  <span className="text-2xs text-noc-text truncate">
                    {targetNode.label || targetNode.name}
                  </span>
                </>
              )}
              {!targetNode && (
                <span className="text-2xs text-noc-text-dim">Unknown</span>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div>
            <label className={labelClass}>Source Anchor</label>
            <input
              type="text"
              value={link.source_anchor ?? ""}
              placeholder="auto"
              onChange={(e) => onUpdate({ source_anchor: e.target.value || null })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Target Anchor</label>
            <input
              type="text"
              value={link.target_anchor ?? ""}
              placeholder="auto"
              onChange={(e) => onUpdate({ target_anchor: e.target.value || null })}
              className={inputClass}
            />
          </div>
        </div>
        <p className="text-2xs text-noc-text-dim mt-1">
          Format: E:90, W:10, N:50, S:25 (side:percent)
        </p>
      </section>

      {/* CAPACITY */}
      <section>
        <div className={labelClass}>Capacity</div>
        <div className="h-px bg-noc-border/50 mb-3" />
        <div className="space-y-2">
          <div>
            <label className={labelClass}>Bandwidth</label>
            <select
              value={link.bandwidth}
              onChange={(e) => {
                const bw = Number(e.target.value);
                const labels: Record<number, string> = {
                  100e6: "100M", 1e9: "1G", 2.5e9: "2.5G", 10e9: "10G",
                  25e9: "25G", 40e9: "40G", 100e9: "100G", 400e9: "400G",
                };
                onUpdate({ bandwidth: bw, bandwidth_label: labels[bw] || `${bw / 1e9}G` });
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
            </select>
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
                className="flex-1 accent-accent"
              />
              <span className="text-2xs text-noc-text-muted tabular-nums w-5 text-right">
                {link.width}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* VISUAL */}
      <section>
        <div className={labelClass}>Visual</div>
        <div className="h-px bg-noc-border/50 mb-3" />
        <div className="space-y-2">
          <div>
            <label className={labelClass}>Label Position</label>
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
            <label className={labelClass}>Line Style</label>
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
            <label className={labelClass}>Color Override</label>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-2xs text-noc-text-muted">
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
                  className="accent-accent"
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
                  className="w-8 h-6 rounded border border-noc-border bg-noc-bg cursor-pointer"
                />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* DATASOURCE */}
      <section>
        <div className={labelClass}>Datasource</div>
        <div className="h-px bg-noc-border/50 mb-3" />
        <PortPicker
          deviceId={sourceNode?.observium_device_id ?? null}
          value={link.observium_port_id_a}
          onChange={(portId) => onUpdate({ observium_port_id_a: portId })}
          label="Port A"
        />
        <div className="mt-2" />
        <PortPicker
          deviceId={targetNode?.observium_device_id ?? null}
          value={link.observium_port_id_b}
          onChange={(portId) => onUpdate({ observium_port_id_b: portId })}
          label="Port B"
        />
      </section>

      {/* URLS */}
      <section>
        <div className={labelClass}>URLs</div>
        <div className="h-px bg-noc-border/50 mb-3" />
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
      <section>
        <div className={labelClass}>Delete</div>
        <div className="h-px bg-noc-border/50 mb-3" />
        <button
          onClick={() => setConfirmDelete(true)}
          className="w-full px-3 py-1.5 text-2xs font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors"
        >
          Delete Link
        </button>
      </section>

      <DeleteConfirmDialog
        open={confirmDelete}
        title="Delete Link"
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
