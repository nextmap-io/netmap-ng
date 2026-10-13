import { useState } from "react";
import type { MapNode, NodeType } from "@/types";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { DevicePicker } from "./DevicePicker";
import { FormField } from "./FormField";
import {
  BLOCK,
  BLOCK_TITLE,
  BUTTON,
  BUTTON_DESTRUCTIVE,
  COLOR_INPUT,
  INPUT,
  LABEL,
  ROW_LABEL,
  STACK,
  TEXT_ACTION,
  pressClass,
  switchThumb,
  switchTrack,
} from "./ui";

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

const inputClass = INPUT;

const labelClass = LABEL;

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
    <div className={STACK}>
      {/* IDENTITY */}
      <section className={BLOCK}>
        <h3 className={BLOCK_TITLE}>Identity</h3>
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
      <section className={BLOCK}>
        <h3 className={BLOCK_TITLE}>Dimensions</h3>
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
      <section className={BLOCK}>
        <h3 className={BLOCK_TITLE}>Behavior</h3>
        <div className="flex items-center justify-between">
          <span id="node-locked-label" className={ROW_LABEL}>
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
            className={switchTrack(!!(node.locked || node.style?.locked))}
          >
            <span className={switchThumb(!!(node.locked || node.style?.locked))} />
          </button>
        </div>
        {node.node_type === "group" && (
          <div className="flex items-center justify-between mt-2">
            <label htmlFor="node-bg-color" className={ROW_LABEL}>
              Background color
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="node-bg-color"
                type="color"
                value={String(node.style?.bg_color || "#1a1f2e")}
                onChange={(e) => onUpdate({ style: { ...node.style, bg_color: e.target.value } })}
                className={COLOR_INPUT}
              />
              {node.style?.bg_color ? (
                <button
                  onClick={() => onUpdate({ style: { ...node.style, bg_color: undefined } })}
                  className={TEXT_ACTION}
                >
                  Reset
                </button>
              ) : null}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between mt-2">
          <span id="node-orthogonal-label" className={ROW_LABEL}>
            Orthogonal links
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={!!node.style?.straight_links}
            aria-labelledby="node-orthogonal-label"
            onClick={() => onUpdate({ style: { ...node.style, straight_links: !node.style?.straight_links } })}
            className={switchTrack(!!node.style?.straight_links)}
          >
            <span className={switchThumb(!!node.style?.straight_links)} />
          </button>
        </div>
      </section>

      {/* TEXT FORMATTING (label nodes only) */}
      {node.node_type === "label" && (
        <section className={BLOCK}>
          <h3 className={BLOCK_TITLE}>Text format</h3>
          <div className="space-y-2">
            <FormField
              label="Font size"
              labelClassName={LABEL}
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
                aria-pressed={!!node.style?.bold}
                title="Bold"
                className={`${pressClass(!!node.style?.bold)} font-bold`}
              >
                B
              </button>
              <button
                onClick={() => onUpdate({ style: { ...node.style, italic: !node.style?.italic } })}
                aria-pressed={!!node.style?.italic}
                title="Italic"
                className={`${pressClass(!!node.style?.italic)} italic`}
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
              labelClassName={LABEL}
            >
              {(id) => (
                <div className="flex items-center gap-2">
                  <input
                    id={id}
                    type="color"
                    value={String(node.style?.color || "#888888")}
                    onChange={(e) => onUpdate({ style: { ...node.style, color: e.target.value } })}
                    className={COLOR_INPUT}
                  />
                  {!!node.style?.color && (
                    <button
                      onClick={() => onUpdate({ style: { ...node.style, color: undefined } })}
                      className={TEXT_ACTION}
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
      <section className={BLOCK}>
        <h3 className={BLOCK_TITLE}>Parent</h3>
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
      <section className={BLOCK}>
        <h3 className={BLOCK_TITLE}>Data source</h3>
        <div className={labelClass}>Observium device</div>
        <DevicePicker
          value={node.observium_device_id}
          onChange={(deviceId) => onUpdate({ observium_device_id: deviceId })}
        />
      </section>

      {/* LAYERING */}
      <section className={BLOCK}>
        <h3 className={BLOCK_TITLE}>Layering</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const maxZ = Math.max(0, ...allNodes.map((n) => n.z_order || 0));
              onUpdate({ z_order: maxZ + 1 });
            }}
            className={`${BUTTON} flex-1`}
          >
            Bring to front
          </button>
          <button
            type="button"
            onClick={() => {
              const minZ = Math.min(0, ...allNodes.map((n) => n.z_order || 0));
              onUpdate({ z_order: minZ - 1 });
            }}
            className={`${BUTTON} flex-1`}
          >
            Send to back
          </button>
        </div>
        <p className="text-sm text-muted-foreground mt-1">Z-order {node.z_order ?? 0}</p>
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
      <section className={BLOCK}>
        <h3 className={BLOCK_TITLE}>URL</h3>
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
      <section className={BLOCK}>
        <h3 className={BLOCK_TITLE}>Delete</h3>
        <button
          onClick={() => setConfirmDelete(true)}
          className={`${BUTTON_DESTRUCTIVE} w-full`}
        >
          Delete node
        </button>
      </section>

      <DeleteConfirmDialog
        open={confirmDelete}
        title="Delete node"
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
