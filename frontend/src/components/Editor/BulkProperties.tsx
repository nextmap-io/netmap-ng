import { useState } from "react";
import type { LinkType, NodeType } from "@/types";
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

const inputClass =
  "w-full bg-noc-bg text-xs text-noc-text rounded border border-noc-border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent/50";
const labelClass = "noc-label mb-1";

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
    <div className="space-y-4">
      <p className="text-2xs text-noc-text-dim">
        Editing <span className="text-accent tabular-nums">{count}</span> nodes. Changes apply to all selected.
      </p>

      <section>
        <div className={labelClass}>Type</div>
        <div className="h-px bg-noc-border/50 mb-3" />
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

      <section>
        <div className={labelClass}>Appearance</div>
        <div className="h-px bg-noc-border/50 mb-3" />
        <div className="flex items-center justify-between mb-2">
          <label htmlFor="bulk-node-color" className="text-2xs text-noc-text-muted uppercase tracking-wider">
            Color
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id="bulk-node-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-6 h-5 rounded border border-noc-border bg-noc-bg cursor-pointer"
            />
            <button
              onClick={() => onApply({ style: { bg_color: color } })}
              className="px-2 py-0.5 text-2xs text-accent border border-accent/30 rounded hover:bg-accent/10 transition-colors"
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

      <section>
        <div className={labelClass}>Behavior</div>
        <div className="h-px bg-noc-border/50 mb-3" />
        <div className="flex items-center gap-2">
          <button
            onClick={() => onApply({ locked: true })}
            className="flex-1 px-2 py-1 text-2xs text-noc-text-muted border border-noc-border rounded hover:text-noc-text transition-colors"
          >
            Lock all
          </button>
          <button
            onClick={() => onApply({ locked: false })}
            className="flex-1 px-2 py-1 text-2xs text-noc-text-muted border border-noc-border rounded hover:text-noc-text transition-colors"
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
    <div className="space-y-4">
      <p className="text-2xs text-noc-text-dim">
        Editing <span className="text-accent tabular-nums">{count}</span> links. Changes apply to all selected.
      </p>

      <section>
        <div className={labelClass}>Type</div>
        <div className="h-px bg-noc-border/50 mb-3" />
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

      <section>
        <div className={labelClass}>Appearance</div>
        <div className="h-px bg-noc-border/50 mb-3" />
        <div className="flex items-center justify-between mb-2">
          <label htmlFor="bulk-link-color" className="text-2xs text-noc-text-muted uppercase tracking-wider">
            Color override
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id="bulk-link-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-6 h-5 rounded border border-noc-border bg-noc-bg cursor-pointer"
            />
            <button
              onClick={() => onApply({ extra: { color_override: color } })}
              className="px-2 py-0.5 text-2xs text-accent border border-accent/30 rounded hover:bg-accent/10 transition-colors"
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
                className="flex-1 accent-accent"
              />
              <span className="text-2xs text-noc-text-muted tabular-nums w-5 text-right">{width}</span>
            </div>
          )}
        </FormField>
      </section>
    </div>
  );
}
