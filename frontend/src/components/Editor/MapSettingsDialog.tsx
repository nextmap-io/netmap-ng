import { useState, useEffect } from "react";
import { api } from "@/api/client";
import { useMapStore } from "@/hooks/useMapStore";
import type { ScaleBand } from "@/types";
import { FormField } from "./FormField";

interface MapSettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

type LocalBand = ScaleBand & { _key: string };

let bandKeyCounter = 0;
const nextBandKey = () => `band-${++bandKeyCounter}`;

export function MapSettingsDialog({ open, onClose }: MapSettingsDialogProps) {
  const { map, loadMap } = useMapStore();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [refreshInterval, setRefreshInterval] = useState(30);
  const [bands, setBands] = useState<LocalBand[]>([]);
  const [scaleMode, setScaleMode] = useState<"steps" | "gradient">("steps");
  const [visibility, setVisibility] = useState<"private" | "internal" | "public">("internal");
  const [publicToken, setPublicToken] = useState<string | null>(null);
  const [showBps, setShowBps] = useState(false);
  const [showBandwidth, setShowBandwidth] = useState(true);
  const [showPercentage, setShowPercentage] = useState(true);
  const [showGraph, setShowGraph] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        ta.style.pointerEvents = "none";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Copy failed", err);
    }
  };

  // Sync local state when dialog opens
  useEffect(() => {
    if (open && map) {
      setName(map.name);
      setDescription(map.description);
      setWidth(map.width);
      setHeight(map.height);
      setRefreshInterval(map.settings.refresh_interval);
      setScaleMode(map.settings.scale_mode === "gradient" ? "gradient" : "steps");
      setVisibility(map.visibility ?? "internal");
      setPublicToken(map.public_token ?? null);
      const ps = map.public_settings ?? { show_bps: false, show_bandwidth: true, show_percentage: true, show_graph: false };
      setShowBps(ps.show_bps ?? false);
      setShowBandwidth(ps.show_bandwidth ?? true);
      setShowPercentage(ps.show_percentage ?? true);
      setShowGraph(ps.show_graph ?? false);
      setBands(
        map.scales.default?.map((b) => ({ ...b, _key: nextBandKey() })) ?? [],
      );
    }
  }, [open, map]);

  if (!open || !map) return null;

  const inputClass =
    "w-full bg-noc-bg text-xs text-noc-text rounded border border-noc-border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent/50";

  const handleBandChange = (idx: number, field: keyof ScaleBand, value: string | number) => {
    setBands((prev) =>
      prev.map((b, i) => (i === idx ? { ...b, [field]: value } : b)),
    );
  };

  const handleAddBand = () => {
    const lastMax = bands.length > 0 ? bands[bands.length - 1].max : 0;
    setBands((prev) => [
      ...prev,
      { min: lastMax, max: lastMax + 10, color: "#00bcd4", label: "", _key: nextBandKey() },
    ]);
  };

  const handleDeleteBand = (idx: number) => {
    setBands((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Reconcile share state here (staged like every other field) rather than
      // firing on the select's onChange — so Cancel reverts cleanly.
      if (visibility === "public" && !publicToken) {
        const result = await api.shareMap(map.id);
        setPublicToken(result.public_token);
      } else if (visibility !== "public" && publicToken) {
        await api.unshareMap(map.id);
        setPublicToken(null);
      }

      await api.updateMap(map.id, {
        name,
        description,
        width,
        height,
        settings: {
          ...map.settings,
          refresh_interval: refreshInterval,
          scale_mode: scaleMode,
        },
        visibility,
        public_settings: { show_bps: showBps, show_bandwidth: showBandwidth, show_percentage: showPercentage, show_graph: showGraph },
        scales: {
          ...map.scales,
          default: bands.map(({ _key: _unused, ...rest }) => rest),
        },
      });
      await loadMap(map.id);
      onClose();
    } catch (e) {
      console.error("Failed to save map settings:", e);
      setError("Failed to save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={onClose}>
      <div
        className="noc-card w-[480px] max-h-[80vh] overflow-y-auto p-4 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <span className="noc-label text-sm">Map Settings</span>
          <button
            onClick={onClose}
            className="text-noc-text-muted hover:text-noc-text transition-colors"
          >
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="space-y-3">
          {/* Map Name */}
          <FormField label="Map Name">
            {(id) => (
              <input
                id={id}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
              />
            )}
          </FormField>

          {/* Description */}
          <FormField label="Description">
            {(id) => (
              <textarea
                id={id}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className={`${inputClass} resize-none`}
              />
            )}
          </FormField>

          {/* Width / Height */}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Width">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                  className={inputClass}
                />
              )}
            </FormField>
            <FormField label="Height">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                  className={inputClass}
                />
              )}
            </FormField>
          </div>

          {/* Refresh Interval */}
          <FormField label="Refresh Interval (seconds)">
            {(id) => (
              <input
                id={id}
                type="number"
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(Number(e.target.value))}
                min={5}
                className={inputClass}
              />
            )}
          </FormField>

          {/* Separator */}
          <div className="h-px bg-noc-border/50 my-2" />

          {/* Scale Mode */}
          <FormField label="Scale Mode">
            {(id) => (
              <select
                id={id}
                value={scaleMode}
                onChange={(e) => setScaleMode(e.target.value as "steps" | "gradient")}
                className={inputClass}
              >
                <option value="steps">Steps (fixed color per band)</option>
                <option value="gradient">Gradient (smooth interpolation)</option>
              </select>
            )}
          </FormField>

          {/* Visibility & Sharing */}
          <div className="space-y-2">
            <FormField label="Visibility">
              {(id) => (
                <select
                  id={id}
                  value={visibility}
                  onChange={(e) => {
                    // Staged only — the actual share/unshare happens on Save so
                    // Cancel discards the change like every other field.
                    setVisibility(e.target.value as "private" | "internal" | "public");
                  }}
                  className={inputClass}
                >
                  <option value="private">Private (owner only)</option>
                  <option value="internal">Internal (any authenticated user)</option>
                  <option value="public">Public (anyone with share link)</option>
                </select>
              )}
            </FormField>
            {visibility === "public" && (
              <div className="space-y-2">
                {publicToken ? (
                  <FormField label="Share Link">
                    {(id) => (
                      <div className="flex items-center gap-1">
                        <input
                          id={id}
                          type="text"
                          readOnly
                          value={`${window.location.origin}/public/${publicToken}`}
                          className={inputClass + " text-2xs"}
                          onClick={(e) => (e.target as HTMLInputElement).select()}
                        />
                        <button
                          onClick={() => copyToClipboard(`${window.location.origin}/public/${publicToken}`)}
                          className="px-2 py-1 text-2xs bg-accent/10 text-accent border border-accent/20 rounded hover:bg-accent/20 transition-colors shrink-0"
                        >
                          {copied ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    )}
                  </FormField>
                ) : (
                  <p className="text-2xs text-noc-text-dim">Save to generate the public share link.</p>
                )}
                <div className="noc-label mb-1">Public Data Visibility</div>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 text-xs text-noc-text">
                    <input type="checkbox" checked={showPercentage} onChange={(e) => setShowPercentage(e.target.checked)} className="accent-accent" />
                    Show utilization %
                  </label>
                  <label className="flex items-center gap-2 text-xs text-noc-text">
                    <input type="checkbox" checked={showBandwidth} onChange={(e) => setShowBandwidth(e.target.checked)} className="accent-accent" />
                    Show link capacity (10G, 40G...)
                  </label>
                  <label className="flex items-center gap-2 text-xs text-noc-text">
                    <input type="checkbox" checked={showBps} onChange={(e) => setShowBps(e.target.checked)} className="accent-accent" />
                    Show traffic in bps
                  </label>
                  <label className="flex items-center gap-2 text-xs text-noc-text">
                    <input type="checkbox" checked={showGraph} onChange={(e) => setShowGraph(e.target.checked)} className="accent-accent" />
                    Allow traffic history graphs
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Color Scale Editor */}
          <div>
            <div className="noc-label mb-2">Color Scale</div>
            <div className="space-y-1.5">
              {bands.map((band, idx) => (
                <div key={band._key} className="flex items-center gap-2">
                  <input
                    type="color"
                    value={band.color}
                    onChange={(e) => handleBandChange(idx, "color", e.target.value)}
                    className="w-7 h-7 rounded border border-noc-border cursor-pointer bg-transparent p-0"
                  />
                  <input
                    type="number"
                    value={band.min}
                    onChange={(e) => handleBandChange(idx, "min", Number(e.target.value))}
                    className={`w-16 bg-noc-bg text-xs text-noc-text rounded border border-noc-border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent/50`}
                    title="Min %"
                  />
                  <span className="text-noc-text-muted text-xs">-</span>
                  <input
                    type="number"
                    value={band.max}
                    onChange={(e) => handleBandChange(idx, "max", Number(e.target.value))}
                    className={`w-16 bg-noc-bg text-xs text-noc-text rounded border border-noc-border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent/50`}
                    title="Max %"
                  />
                  <input
                    type="text"
                    value={band.label}
                    onChange={(e) => handleBandChange(idx, "label", e.target.value)}
                    placeholder="Label"
                    className={`flex-1 bg-noc-bg text-xs text-noc-text rounded border border-noc-border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent/50`}
                  />
                  <button
                    onClick={() => handleDeleteBand(idx)}
                    className="text-noc-text-muted hover:text-node-firewall transition-colors p-0.5"
                    title="Remove band"
                  >
                    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={handleAddBand}
              className="mt-2 text-2xs text-accent hover:text-accent/80 transition-colors"
            >
              + Add Band
            </button>
          </div>
        </div>

        {/* Footer buttons */}
        {error && (
          <p className="mt-4 text-2xs text-node-firewall">{error}</p>
        )}
        <div className="flex justify-end gap-2 mt-5 pt-3 border-t border-noc-border/50">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-noc-text-muted hover:text-noc-text border border-noc-border rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-xs text-accent bg-accent/10 border border-accent/20 rounded hover:bg-accent/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
