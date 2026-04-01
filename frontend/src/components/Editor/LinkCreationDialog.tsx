import { useState, useEffect, useMemo } from "react";
import type { MapNode, LinkType } from "@/types";

interface LinkCreationDialogProps {
  open: boolean;
  nodes: MapNode[];
  onClose: () => void;
  onCreate: (data: Record<string, unknown>) => Promise<void>;
}

const LINK_TYPES: LinkType[] = [
  "internal",
  "transit",
  "peering_ix",
  "peering_pni",
  "customer",
  "trunk",
  "lag",
  "custom",
];

function parseBandwidth(label: string): number {
  const match = label.trim().match(/^([\d.]+)\s*(T|G|M|K)?$/i);
  if (!match) return 1_000_000_000;
  const value = parseFloat(match[1]);
  const unit = (match[2] || "").toUpperCase();
  switch (unit) {
    case "T": return value * 1e12;
    case "G": return value * 1e9;
    case "M": return value * 1e6;
    case "K": return value * 1e3;
    default: return value;
  }
}

export function LinkCreationDialog({
  open,
  nodes,
  onClose,
  onCreate,
}: LinkCreationDialogProps) {
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [name, setName] = useState("");
  const [linkType, setLinkType] = useState<LinkType>("internal");
  const [bandwidthLabel, setBandwidthLabel] = useState("1G");
  const [creating, setCreating] = useState(false);

  // Filter out group nodes
  const availableNodes = useMemo(
    () => nodes.filter((n) => n.node_type !== "group"),
    [nodes],
  );

  // Target options exclude the selected source
  const targetNodes = useMemo(
    () => availableNodes.filter((n) => n.id !== sourceId),
    [availableNodes, sourceId],
  );

  // Auto-fill name when source and target change
  useEffect(() => {
    if (sourceId && targetId) {
      const sourceNode = availableNodes.find((n) => n.id === sourceId);
      const targetNode = availableNodes.find((n) => n.id === targetId);
      if (sourceNode && targetNode) {
        setName(`${sourceNode.label || sourceNode.name} - ${targetNode.label || targetNode.name}`);
      }
    }
  }, [sourceId, targetId, availableNodes]);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setSourceId("");
      setTargetId("");
      setName("");
      setLinkType("internal");
      setBandwidthLabel("1G");
      setCreating(false);
    }
  }, [open]);

  // Clear target if it matches new source
  useEffect(() => {
    if (targetId === sourceId) setTargetId("");
  }, [sourceId, targetId]);

  if (!open) return null;

  const canCreate = sourceId && targetId && name.trim();

  const handleCreate = async () => {
    if (!canCreate) return;
    setCreating(true);
    try {
      await onCreate({
        name: name.trim(),
        link_type: linkType,
        source_id: sourceId,
        target_id: targetId,
        bandwidth_label: bandwidthLabel,
        bandwidth: parseBandwidth(bandwidthLabel),
      });
      onClose();
    } catch {
      setCreating(false);
    }
  };

  const selectClass =
    "w-full bg-noc-bg border border-noc-border rounded px-2 py-1.5 text-2xs text-noc-text focus:border-accent/50 outline-none transition-colors";
  const inputClass = selectClass;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="noc-card rounded-lg shadow-lg w-96 animate-fade-in">
        {/* Header */}
        <div className="px-4 pt-4 pb-2">
          <h3 className="text-xs font-semibold text-noc-text">Create Link</h3>
        </div>

        {/* Body */}
        <div className="px-4 pb-4 flex flex-col gap-3">
          {/* Source */}
          <div>
            <label className="noc-label mb-1 block">Source</label>
            <select
              className={selectClass}
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
            >
              <option value="">Select source node...</option>
              {availableNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label || n.name}
                </option>
              ))}
            </select>
          </div>

          {/* Target */}
          <div>
            <label className="noc-label mb-1 block">Target</label>
            <select
              className={selectClass}
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            >
              <option value="">Select target node...</option>
              {targetNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label || n.name}
                </option>
              ))}
            </select>
          </div>

          {/* Name */}
          <div>
            <label className="noc-label mb-1 block">Name</label>
            <input
              className={inputClass}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Link name"
            />
          </div>

          {/* Type */}
          <div>
            <label className="noc-label mb-1 block">Type</label>
            <select
              className={selectClass}
              value={linkType}
              onChange={(e) => setLinkType(e.target.value as LinkType)}
            >
              {LINK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          {/* Bandwidth Label */}
          <div>
            <label className="noc-label mb-1 block">Bandwidth Label</label>
            <input
              className={inputClass}
              type="text"
              value={bandwidthLabel}
              onChange={(e) => setBandwidthLabel(e.target.value)}
              placeholder="1G"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-4 pb-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-2xs font-medium text-noc-text-muted bg-noc-bg border border-noc-border rounded hover:bg-noc-surface transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!canCreate || creating}
            className="px-3 py-1.5 text-2xs font-medium text-accent bg-accent/10 border border-accent/20 rounded hover:bg-accent/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {creating ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
