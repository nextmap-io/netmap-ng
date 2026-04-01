import { useState } from "react";
import type { MapNode, NodeType } from "@/types";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { DevicePicker } from "./DevicePicker";

const NODE_TYPES: { value: NodeType; label: string }[] = [
  { value: "router", label: "Router" },
  { value: "switch_l3", label: "Switch L3" },
  { value: "switch_l2", label: "Switch L2" },
  { value: "server", label: "Server" },
  { value: "firewall", label: "Firewall" },
  { value: "ix", label: "IX Peering" },
  { value: "transit", label: "Transit" },
  { value: "pni", label: "PNI" },
  { value: "provider", label: "Provider" },
  { value: "cloud", label: "Cloud" },
  { value: "internet", label: "External" },
  { value: "group", label: "Group / Site" },
  { value: "custom", label: "Custom" },
];

const inputClass =
  "w-full bg-noc-bg text-xs text-noc-text rounded border border-noc-border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent/50";

const labelClass = "noc-label mb-1";

interface NodePropertiesProps {
  node: MapNode;
  allNodes: MapNode[];
  onUpdate: (fields: Record<string, unknown>) => void;
  onDelete: () => void;
}

export function NodeProperties({
  node,
  allNodes,
  onUpdate,
  onDelete,
}: NodePropertiesProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const groupNodes = allNodes.filter(
    (n) => n.node_type === "group" && n.id !== node.id,
  );

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
              value={node.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Label</label>
            <input
              type="text"
              value={node.label}
              onChange={(e) => onUpdate({ label: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Type</label>
            <select
              value={node.node_type}
              onChange={(e) =>
                onUpdate({ node_type: e.target.value as NodeType })
              }
              className={inputClass}
            >
              {NODE_TYPES.map((nt) => (
                <option key={nt.value} value={nt.value}>
                  {nt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* DIMENSIONS */}
      <section>
        <div className={labelClass}>Dimensions</div>
        <div className="h-px bg-noc-border/50 mb-3" />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>Width</label>
            <input
              type="number"
              value={node.width ?? ""}
              placeholder="auto"
              onChange={(e) =>
                onUpdate({ width: e.target.value ? parseInt(e.target.value, 10) : null })
              }
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Height</label>
            <input
              type="number"
              value={node.height ?? ""}
              placeholder="auto"
              onChange={(e) =>
                onUpdate({ height: e.target.value ? parseInt(e.target.value, 10) : null })
              }
              className={inputClass}
            />
            </div>
          </div>
      </section>

      {/* BEHAVIOR */}
      <section>
        <div className={labelClass}>Behavior</div>
        <div className="h-px bg-noc-border/50 mb-3" />
        <div className="flex items-center justify-between">
          <label className="text-2xs text-noc-text-muted uppercase tracking-wider">
            Locked
          </label>
          <button
            type="button"
            role="switch"
            aria-checked={node.locked}
            onClick={() => onUpdate({ locked: !node.locked })}
            className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${
              node.locked ? "bg-accent" : "bg-noc-border"
            }`}
          >
            <span
              className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                node.locked ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </section>

      {/* PARENT */}
      <section>
        <div className={labelClass}>Parent</div>
        <div className="h-px bg-noc-border/50 mb-3" />
        <div>
          <label className={labelClass}>Parent</label>
          <select
            value={node.parent_id ?? ""}
            onChange={(e) =>
              onUpdate({ parent_id: e.target.value || null })
            }
            className={inputClass}
          >
            <option value="">None</option>
            {groupNodes.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label || g.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* DATASOURCE */}
      <section>
        <div className={labelClass}>Datasource</div>
        <div className="h-px bg-noc-border/50 mb-3" />
        <label className={labelClass}>Observium Device</label>
        <DevicePicker
          value={node.observium_device_id}
          onChange={(deviceId) => onUpdate({ observium_device_id: deviceId })}
        />
      </section>

      {/* URL */}
      <section>
        <div className={labelClass}>URL</div>
        <div className="h-px bg-noc-border/50 mb-3" />
        <div>
          <label className={labelClass}>Info URL</label>
          <input
            type="text"
            value={node.info_url ?? ""}
            onChange={(e) =>
              onUpdate({ info_url: e.target.value || null })
            }
            className={inputClass}
            placeholder="https://..."
          />
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
          Delete Node
        </button>
      </section>

      <DeleteConfirmDialog
        open={confirmDelete}
        title="Delete Node"
        message={`Are you sure you want to delete "${node.label || node.name}"? This will also remove all connected links.`}
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
