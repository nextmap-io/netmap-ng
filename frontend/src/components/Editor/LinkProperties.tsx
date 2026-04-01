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
  group: "GRP", custom: "---",
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
  group: "bg-noc-muted/20 text-noc-text-muted",
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
      </section>

      {/* CAPACITY */}
      <section>
        <div className={labelClass}>Capacity</div>
        <div className="h-px bg-noc-border/50 mb-3" />
        <div className="space-y-2">
          <div>
            <label className={labelClass}>Bandwidth (bps)</label>
            <input
              type="number"
              value={link.bandwidth}
              onChange={(e) =>
                onUpdate({ bandwidth: parseInt(e.target.value, 10) || 0 })
              }
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Label</label>
            <input
              type="text"
              value={link.bandwidth_label}
              onChange={(e) => onUpdate({ bandwidth_label: e.target.value })}
              className={inputClass}
              placeholder="e.g. 10G"
            />
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
            <label className={labelClass}>Via Style</label>
            <select
              value={link.via_style}
              onChange={(e) =>
                onUpdate({ via_style: e.target.value as "curved" | "angled" })
              }
              className={inputClass}
            >
              <option value="curved">Curved</option>
              <option value="angled">Angled</option>
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
