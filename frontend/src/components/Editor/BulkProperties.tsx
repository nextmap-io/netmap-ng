import { useState } from "react";
import type { LinkType, NodeType } from "@/types";
import { FormField } from "./FormField";
import { BLOCK, BLOCK_TITLE, BUTTON, COLOR_INPUT, INPUT, LABEL, ROW_LABEL, STACK } from "./ui";

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
  { value: "custom", label: "Custom" },
];

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

const inputClass = INPUT;
const labelClass = LABEL;

interface BulkNodeProps {
  count: number;
  onApply: (fields: Record<string, unknown>) => void;
}

/** Bulk editor for 2+ selected nodes. Each control applies to all at once. */
export function BulkNodeProperties({ count, onApply }: BulkNodeProps) {
  const [color, setColor] = useState("#1a1f2e");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");

  return (
    <div className={STACK}>
      <p className="text-sm text-muted-foreground">
        Editing <span className="text-foreground">{count}</span> nodes. Changes apply to all selected.
      </p>

      <section className={BLOCK}>
        <h3 className={BLOCK_TITLE}>Type</h3>
        <FormField label="Set type" labelClassName={labelClass}>
          {(id) => (
            <select
              id={id}
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) onApply({ node_type: e.target.value as NodeType });
              }}
              className={inputClass}
            >
              <option value="" disabled>
                Choose type…
              </option>
              {NODE_TYPES.map((nt) => (
                <option key={nt.value} value={nt.value}>
                  {nt.label}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </section>

      <section className={BLOCK}>
        <h3 className={BLOCK_TITLE}>Appearance</h3>
        <div className="flex items-center justify-between mb-2">
          <label htmlFor="bulk-node-color" className={ROW_LABEL}>
            Color
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id="bulk-node-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className={COLOR_INPUT}
            />
            <button
              onClick={() => onApply({ style: { bg_color: color } })}
              className={BUTTON}
            >
              Apply
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <FormField label="Width" labelClassName={labelClass}>
            {(id) => (
              <input
                id={id}
                type="number"
                value={width}
                placeholder="—"
                onChange={(e) => setWidth(e.target.value)}
                onBlur={() => {
                  if (width) onApply({ width: parseInt(width, 10) });
                }}
                className={inputClass}
              />
            )}
          </FormField>
          <FormField label="Height" labelClassName={labelClass}>
            {(id) => (
              <input
                id={id}
                type="number"
                value={height}
                placeholder="—"
                onChange={(e) => setHeight(e.target.value)}
                onBlur={() => {
                  if (height) onApply({ height: parseInt(height, 10) });
                }}
                className={inputClass}
              />
            )}
          </FormField>
        </div>
      </section>

      <section className={BLOCK}>
        <h3 className={BLOCK_TITLE}>Behavior</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onApply({ locked: true })}
            className={`${BUTTON} flex-1`}
          >
            Lock all
          </button>
          <button
            onClick={() => onApply({ locked: false })}
            className={`${BUTTON} flex-1`}
          >
            Unlock all
          </button>
        </div>
      </section>
    </div>
  );
}

interface BulkLinkProps {
  count: number;
  onApply: (fields: Record<string, unknown>) => void;
}

/** Bulk editor for 2+ selected links. */
export function BulkLinkProperties({ count, onApply }: BulkLinkProps) {
  const [color, setColor] = useState("#3b82f6");
  const [width, setWidth] = useState(4);

  return (
    <div className={STACK}>
      <p className="text-sm text-muted-foreground">
        Editing <span className="text-foreground">{count}</span> links. Changes apply to all selected.
      </p>

      <section className={BLOCK}>
        <h3 className={BLOCK_TITLE}>Type</h3>
        <FormField label="Set type" labelClassName={labelClass}>
          {(id) => (
            <select
              id={id}
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) onApply({ link_type: e.target.value as LinkType });
              }}
              className={inputClass}
            >
              <option value="" disabled>
                Choose type…
              </option>
              {LINK_TYPES.map((lt) => (
                <option key={lt.value} value={lt.value}>
                  {lt.label}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </section>

      <section className={BLOCK}>
        <h3 className={BLOCK_TITLE}>Appearance</h3>
        <div className="flex items-center justify-between mb-2">
          <label htmlFor="bulk-link-color" className={ROW_LABEL}>
            Color override
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id="bulk-link-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className={COLOR_INPUT}
            />
            <button
              onClick={() => onApply({ extra: { color_override: color } })}
              className={BUTTON}
            >
              Apply
            </button>
          </div>
        </div>
        <FormField label="Width" labelClassName={labelClass}>
          {(id) => (
            <div className="flex items-center gap-2">
              <input
                id={id}
                type="range"
                min={1}
                max={20}
                value={width}
                onChange={(e) => setWidth(parseInt(e.target.value, 10))}
                onMouseUp={() => onApply({ width })}
                onTouchEnd={() => onApply({ width })}
                className="flex-1"
                style={{ accentColor: "var(--color-foreground)" }}
              />
              <span className="text-sm text-foreground-secondary w-6 text-right">{width}</span>
            </div>
          )}
        </FormField>
      </section>
    </div>
  );
}
