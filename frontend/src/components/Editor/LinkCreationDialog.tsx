import { useState, useEffect, useMemo } from "react";
import type { MapNode, MapLink, LinkType } from "@/types";
import { parseBandwidth } from "@/utils/bandwidth";

interface LinkCreationDialogProps {
  open: boolean;
  nodes: MapNode[];
  existingLinks?: MapLink[];
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

export function LinkCreationDialog({
  open,
  nodes,
  existingLinks = [],
  onClose,
  onCreate,
}: LinkCreationDialogProps) {
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [name, setName] = useState("");
  const [linkType, setLinkType] = useState<LinkType>("internal");
  const [bandwidthLabel, setBandwidthLabel] = useState("1G");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setSourceId("");
      setTargetId("");
      setName("");
      setLinkType("internal");
      setBandwidthLabel("1G");
      setCreating(false);
      setError(null);
    }
  }, [open]);

  // Warn if a link already connects this (unordered) pair of endpoints.
  const isDuplicate = useMemo(() => {
    if (!sourceId || !targetId) return false;
    return existingLinks.some(
      (l) =>
        (l.source_id === sourceId && l.target_id === targetId) ||
        (l.source_id === targetId && l.target_id === sourceId),
    );
  }, [existingLinks, sourceId, targetId]);

  const autoName = (sId: string, tId: string) => {
    if (!sId || !tId) return "";
    const s = availableNodes.find((n) => n.id === sId);
    const t = availableNodes.find((n) => n.id === tId);
    return s && t
      ? `${s.label || s.name} - ${t.label || t.name}`
      : "";
  };

  const handleSourceChange = (next: string) => {
    setSourceId(next);
    const nextTarget = targetId === next ? "" : targetId;
    if (nextTarget !== targetId) setTargetId(nextTarget);
    const fill = autoName(next, nextTarget);
    if (fill) setName(fill);
  };

  const handleTargetChange = (next: string) => {
    setTargetId(next);
    const fill = autoName(sourceId, next);
    if (fill) setName(fill);
  };

  if (!open) return null;

  const canCreate = sourceId && targetId && name.trim();

  const handleCreate = async () => {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
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
      setError("Failed to create link. Please try again.");
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
              onChange={(e) => handleSourceChange(e.target.value)}
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
              onChange={(e) => handleTargetChange(e.target.value)}
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
          {isDuplicate && (
            <p className="text-2xs text-amber-400">
              A link already connects these two nodes.
            </p>
          )}
          {error && <p className="text-2xs text-node-firewall">{error}</p>}
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
