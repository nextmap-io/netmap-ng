import { useState, useMemo } from "react";
import type { MapNode, MapLink, LinkType, ObserviumPort } from "@/types";
import { parseBandwidth, formatBandwidthLabel } from "@/utils/bandwidth";
import { portSpeedBps } from "@/utils/portSpeed";
import { PortPicker } from "./PortPicker";
import { BACKDROP, BUTTON, BUTTON_PRIMARY, HINT, INPUT, LABEL, SURFACE, TEXT_ACTION, TITLE } from "./ui";

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

const LINK_TYPE_LABELS: Record<LinkType, string> = {
  internal: "Internal",
  transit: "Transit",
  peering_ix: "Peering IX",
  peering_pni: "Peering PNI",
  customer: "Customer",
  trunk: "Trunk",
  lag: "LAG",
  custom: "Custom",
};

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
  // Once the user types a capacity, port picks no longer overwrite it.
  const [bandwidthEdited, setBandwidthEdited] = useState(false);
  const [portA, setPortA] = useState<ObserviumPort | null>(null);
  const [portB, setPortB] = useState<ObserviumPort | null>(null);
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

  // Reset the form each time the dialog opens (adjusted during render, React's
  // "adjust state when a prop changes" pattern, instead of an effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSourceId("");
      setTargetId("");
      setName("");
      setLinkType("internal");
      setBandwidthLabel("1G");
      setBandwidthEdited(false);
      setPortA(null);
      setPortB(null);
      setCreating(false);
      setError(null);
    }
  }

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

  const sourceNode = availableNodes.find((n) => n.id === sourceId);
  const targetNode = availableNodes.find((n) => n.id === targetId);
  const sourceDevice = sourceNode?.observium_device_id ?? null;
  const targetDevice = targetNode?.observium_device_id ?? null;
  const detectedBps = portSpeedBps(portA) || portSpeedBps(portB);

  // Prefill capacity from the picked port(s) unless the user set one by hand.
  const pickPort = (side: "a" | "b", port: ObserviumPort | null) => {
    const nextA = side === "a" ? port : portA;
    const nextB = side === "b" ? port : portB;
    if (side === "a") setPortA(port);
    else setPortB(port);
    const speed = portSpeedBps(nextA) || portSpeedBps(nextB);
    if (!bandwidthEdited && speed > 0) setBandwidthLabel(formatBandwidthLabel(speed));
  };

  const handleSourceChange = (next: string) => {
    if (next !== sourceId) setPortA(null);
    setSourceId(next);
    const nextTarget = targetId === next ? "" : targetId;
    if (nextTarget !== targetId) {
      setTargetId(nextTarget);
      setPortB(null);
    }
    const fill = autoName(next, nextTarget);
    if (fill) setName(fill);
  };

  const handleTargetChange = (next: string) => {
    if (next !== targetId) setPortB(null);
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
        ...(portA ? { observium_port_id_a: portA.port_id } : {}),
        ...(portB ? { observium_port_id_b: portB.port_id } : {}),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "the server rejected the request.");
      setCreating(false);
    }
  };

  const selectClass = INPUT;
  const inputClass = INPUT;

  return (
    <div role="presentation" className={BACKDROP}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-create-title"
        className={`${SURFACE} w-full max-w-md max-h-[90vh] overflow-y-auto`}
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-2">
          <h3 id="link-create-title" className={TITLE}>Create a link</h3>
        </div>

        {/* Body */}
        <div className="px-4 pb-4 flex flex-col gap-3">
          {/* Source */}
          <div>
            <label className={LABEL}>Source</label>
            <select
              className={selectClass}
              value={sourceId}
              onChange={(e) => handleSourceChange(e.target.value)}
            >
              <option value="">Select source node…</option>
              {availableNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label || n.name}
                </option>
              ))}
            </select>
          </div>

          {/* Target */}
          <div>
            <label className={LABEL}>Target</label>
            <select
              className={selectClass}
              value={targetId}
              onChange={(e) => handleTargetChange(e.target.value)}
            >
              <option value="">Select target node…</option>
              {targetNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label || n.name}
                </option>
              ))}
            </select>
          </div>

          {/* Name */}
          <div>
            <label className={LABEL}>Name</label>
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
            <label className={LABEL}>Type</label>
            <select
              className={selectClass}
              value={linkType}
              onChange={(e) => setLinkType(e.target.value as LinkType)}
            >
              {LINK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {LINK_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          {/* Optional Observium port binding (only for device-bound endpoints) */}
          {(sourceDevice != null || targetDevice != null) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <PortPicker
                deviceId={sourceDevice}
                value={portA?.port_id ?? null}
                onChange={(_, port) => pickPort("a", port)}
                label="Port A (optional)"
              />
              <PortPicker
                deviceId={targetDevice}
                value={portB?.port_id ?? null}
                onChange={(_, port) => pickPort("b", port)}
                label="Port B (optional)"
              />
            </div>
          )}

          {/* Bandwidth Label */}
          <div>
            <label className={LABEL}>Capacity</label>
            <input
              className={inputClass}
              type="text"
              value={bandwidthLabel}
              onChange={(e) => {
                setBandwidthLabel(e.target.value);
                setBandwidthEdited(true);
              }}
              placeholder="1G"
            />
            {detectedBps > 0 && (
              <div className="flex items-center justify-between gap-2 mt-1">
                <span className={HINT}>
                  Port speed {formatBandwidthLabel(detectedBps)}
                </span>
                {parseBandwidth(bandwidthLabel) !== detectedBps && (
                  <button
                    type="button"
                    onClick={() => setBandwidthLabel(formatBandwidthLabel(detectedBps))}
                    className={`${TEXT_ACTION} whitespace-nowrap`}
                  >
                    Use port speed ({formatBandwidthLabel(detectedBps)})
                  </button>
                )}
              </div>
            )}
          </div>
          {isDuplicate && (
            <p className="text-sm text-foreground-secondary">
              <span className="mr-1 px-1.5 py-px rounded text-sm font-medium text-warning bg-warning-muted">Watch</span>
              A link already connects these two nodes.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-foreground-secondary">
              <span className="font-medium text-destructive">Couldn&apos;t create the link</span>: {error}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-4 pb-4">
          <button
            onClick={onClose}
            className={BUTTON}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!canCreate || creating}
            className={BUTTON_PRIMARY}
          >
            {creating ? "Creating…" : "Create link"}
          </button>
        </div>
      </div>
    </div>
  );
}
