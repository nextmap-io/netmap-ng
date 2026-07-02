import { useState } from "react";
import type { MapNode, NodeType } from "@/types";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { DevicePicker } from "./DevicePicker";
import { FormField } from "./FormField";

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
  { value: "label", label: "Text Label" },
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
          <FormField label="Name" labelClassName={labelClass}>
            {(id) => (
              <input
                id={id}
                type="text"
                value={node.name}
                onChange={(e) => onUpdate({ name: e.target.value })}
                className={inputClass}
              />
            )}
          </FormField>
          <FormField label="Label" labelClassName={labelClass}>
            {(id) => (
              <input
                id={id}
                type="text"
                value={node.label}
                onChange={(e) => onUpdate({ label: e.target.value })}
                className={inputClass}
              />
            )}
          </FormField>
          <FormField label="Type" labelClassName={labelClass}>
            {(id) => (
              <select
                id={id}
                value={node.node_type}
                onChange={(e) => onUpdate({ node_type: e.target.value as NodeType })}
                className={inputClass}
              >
                {NODE_TYPES.map((nt) => (
                  <option key={nt.value} value={nt.value}>
                    {nt.label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </div>
      </section>

      {/* DIMENSIONS */}
      <section>
        <div className={labelClass}>Dimensions</div>
        <div className="h-px bg-noc-border/50 mb-3" />
        <div className="grid grid-cols-2 gap-2">
          <FormField label="Width" labelClassName={labelClass}>
            {(id) => (
              <input
                id={id}
                type="number"
                value={node.width ?? ""}
                placeholder="auto"
                onChange={(e) =>
                  onUpdate({ width: e.target.value ? parseInt(e.target.value, 10) : null })
                }
                className={inputClass}
              />
            )}
          </FormField>
          <FormField label="Height" labelClassName={labelClass}>
            {(id) => (
              <input
                id={id}
                type="number"
                value={node.height ?? ""}
                placeholder="auto"
                onChange={(e) =>
                  onUpdate({ height: e.target.value ? parseInt(e.target.value, 10) : null })
                }
                className={inputClass}
              />
            )}
          </FormField>
        </div>
      </section>

      {/* BEHAVIOR */}
      <section>
        <div className={labelClass}>Behavior</div>
        <div className="h-px bg-noc-border/50 mb-3" />
        <div className="flex items-center justify-between">
          <span id="node-locked-label" className="text-2xs text-noc-text-muted uppercase tracking-wider">
            Locked
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={node.locked || !!node.style?.locked}
            aria-labelledby="node-locked-label"
            onClick={() => {
              const isLocked = node.locked || !!node.style?.locked;
              onUpdate({ locked: !isLocked, style: { ...node.style, locked: undefined } });
            }}
            className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${
              (node.locked || node.style?.locked) ? "bg-accent" : "bg-noc-border"
            }`}
          >
            <span
              className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                (node.locked || node.style?.locked) ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
        {node.node_type === "group" && (
          <div className="flex items-center justify-between mt-2">
            <label htmlFor="node-bg-color" className="text-2xs text-noc-text-muted uppercase tracking-wider">
              Background Color
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="node-bg-color"
                type="color"
                value={String(node.style?.bg_color || "#1a1f2e")}
                onChange={(e) => onUpdate({ style: { ...node.style, bg_color: e.target.value } })}
                className="w-6 h-5 rounded border border-noc-border bg-noc-bg cursor-pointer"
              />
              {node.style?.bg_color ? (
                <button
                  onClick={() => onUpdate({ style: { ...node.style, bg_color: undefined } })}
                  className="text-2xs text-noc-text-dim hover:text-noc-text"
                >
                  Reset
                </button>
              ) : null}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between mt-2">
          <span id="node-orthogonal-label" className="text-2xs text-noc-text-muted uppercase tracking-wider">
            Orthogonal Links
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={!!node.style?.straight_links}
            aria-labelledby="node-orthogonal-label"
            onClick={() => onUpdate({ style: { ...node.style, straight_links: !node.style?.straight_links } })}
            className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${
              node.style?.straight_links ? "bg-accent" : "bg-noc-border"
            }`}
          >
            <span
              className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                node.style?.straight_links ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </section>

      {/* TEXT FORMATTING (label nodes only) */}
      {node.node_type === "label" && (
        <section>
          <div className={labelClass}>Text Format</div>
          <div className="h-px bg-noc-border/50 mb-3" />
          <div className="space-y-2">
            <FormField
              label="Font Size"
              labelClassName="text-2xs text-noc-text-muted uppercase tracking-wider mb-1 block"
            >
              {(id) => (
                <select
                  id={id}
                  value={String(node.style?.font_size || "12")}
                  onChange={(e) => onUpdate({ style: { ...node.style, font_size: e.target.value } })}
                  className={inputClass}
                >
                  <option value="9">9px — Small</option>
                  <option value="11">11px — Default</option>
                  <option value="14">14px — Medium</option>
                  <option value="18">18px — Large</option>
                  <option value="24">24px — Title</option>
                </select>
              )}
            </FormField>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onUpdate({ style: { ...node.style, bold: !node.style?.bold } })}
                className={`px-2 py-1 rounded text-2xs font-bold border transition-colors ${
                  node.style?.bold
                    ? "bg-accent/15 text-accent border-accent/20"
                    : "text-noc-text-muted border-noc-border hover:text-noc-text"
                }`}
              >
                B
              </button>
              <button
                onClick={() => onUpdate({ style: { ...node.style, italic: !node.style?.italic } })}
                className={`px-2 py-1 rounded text-2xs italic border transition-colors ${
                  node.style?.italic
                    ? "bg-accent/15 text-accent border-accent/20"
                    : "text-noc-text-muted border-noc-border hover:text-noc-text"
                }`}
              >
                I
              </button>
              <select
                value={String(node.style?.align || "left")}
                onChange={(e) => onUpdate({ style: { ...node.style, align: e.target.value } })}
                className={`${inputClass} w-auto flex-1`}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
            <FormField
              label="Color"
              labelClassName="text-2xs text-noc-text-muted uppercase tracking-wider mb-1 block"
            >
              {(id) => (
                <div className="flex items-center gap-2">
                  <input
                    id={id}
                    type="color"
                    value={String(node.style?.color || "#888888")}
                    onChange={(e) => onUpdate({ style: { ...node.style, color: e.target.value } })}
                    className="w-8 h-6 rounded border border-noc-border bg-noc-bg cursor-pointer"
                  />
                  {!!node.style?.color && (
                    <button
                      onClick={() => onUpdate({ style: { ...node.style, color: undefined } })}
                      className="text-2xs text-noc-text-dim hover:text-noc-text"
                    >
                      Reset
                    </button>
                  )}
                </div>
              )}
            </FormField>
          </div>
        </section>
      )}

      {/* PARENT */}
      <section>
        <div className={labelClass}>Parent</div>
        <div className="h-px bg-noc-border/50 mb-3" />
        <FormField label="Parent" labelClassName={labelClass}>
          {(id) => (
            <select
              id={id}
              value={node.parent_id ?? ""}
              onChange={(e) => onUpdate({ parent_id: e.target.value || null })}
              className={inputClass}
            >
              <option value="">None</option>
              {groupNodes.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label || g.name}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </section>

      {/* DATASOURCE */}
      <section>
        <div className={labelClass}>Datasource</div>
        <div className="h-px bg-noc-border/50 mb-3" />
        <div className={labelClass}>Observium Device</div>
        <DevicePicker
          value={node.observium_device_id}
          onChange={(deviceId) => onUpdate({ observium_device_id: deviceId })}
        />
      </section>

      {/* LAYERING */}
      <section>
        <div className={labelClass}>Layering</div>
        <div className="h-px bg-noc-border/50 mb-3" />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const maxZ = Math.max(0, ...allNodes.map((n) => n.z_order || 0));
              onUpdate({ z_order: maxZ + 1 });
            }}
            className="flex-1 px-2 py-1 text-2xs text-noc-text-muted border border-noc-border rounded hover:bg-noc-surface hover:text-noc-text transition-colors"
          >
            Bring to Front
          </button>
          <button
            type="button"
            onClick={() => {
              const minZ = Math.min(0, ...allNodes.map((n) => n.z_order || 0));
              onUpdate({ z_order: minZ - 1 });
            }}
            className="flex-1 px-2 py-1 text-2xs text-noc-text-muted border border-noc-border rounded hover:bg-noc-surface hover:text-noc-text transition-colors"
          >
            Send to Back
          </button>
        </div>
        <p className="text-2xs text-noc-text-dim mt-1 tabular-nums">z-order: {node.z_order ?? 0}</p>
        <FormField label="Icon" labelClassName={`${labelClass} mt-2`}>
          {(id) => (
            <input
              id={id}
              type="text"
              value={node.icon ?? ""}
              placeholder="icon name / short code"
              onChange={(e) => onUpdate({ icon: e.target.value || null })}
              className={inputClass}
            />
          )}
        </FormField>
      </section>

      {/* URL */}
      <section>
        <div className={labelClass}>URL</div>
        <div className="h-px bg-noc-border/50 mb-3" />
        <FormField label="Info URL" labelClassName={labelClass}>
          {(id) => (
            <input
              id={id}
              type="text"
              value={node.info_url ?? ""}
              onChange={(e) => onUpdate({ info_url: e.target.value || null })}
              className={inputClass}
              placeholder="https://..."
            />
          )}
        </FormField>
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
