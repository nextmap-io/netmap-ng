import { useState, useEffect } from "react";
import { api } from "@/api/client";
import { useMapStore } from "@/hooks/useMapStore";
import type { ScaleBand } from "@/types";

interface MapSettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function MapSettingsDialog({ open, onClose }: MapSettingsDialogProps) {
  const { map, loadMap } = useMapStore();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [refreshInterval, setRefreshInterval] = useState(30);
  const [bands, setBands] = useState<ScaleBand[]>([]);
  const [scaleMode, setScaleMode] = useState<"steps" | "gradient">("steps");
  const [saving, setSaving] = useState(false);

  // Sync local state when dialog opens
  useEffect(() => {
    if (open && map) {
      setName(map.name);
      setDescription(map.description);
      setWidth(map.width);
      setHeight(map.height);
      setRefreshInterval(map.settings.refresh_interval);
      setScaleMode(map.settings.scale_mode === "gradient" ? "gradient" : "steps");
      setBands(map.scales.default?.map((b) => ({ ...b })) ?? []);
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
      { min: lastMax, max: lastMax + 10, color: "#00bcd4", label: "" },
    ]);
  };

  const handleDeleteBand = (idx: number) => {
    setBands((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
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
        scales: {
          ...map.scales,
          default: bands,
        },
      });
      await loadMap(map.id);
      onClose();
    } catch (e) {
      console.error("Failed to save map settings:", e);
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
          <div>
            <label className="noc-label mb-1 block">Map Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>

          {/* Description */}
          <div>
            <label className="noc-label mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className={`${inputClass} resize-none`}
            />
          </div>

          {/* Width / Height */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="noc-label mb-1 block">Width</label>
              <input
                type="number"
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                className={inputClass}
              />
            </div>
            <div>
              <label className="noc-label mb-1 block">Height</label>
              <input
                type="number"
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
                className={inputClass}
              />
            </div>
          </div>

          {/* Refresh Interval */}
          <div>
            <label className="noc-label mb-1 block">Refresh Interval (seconds)</label>
            <input
              type="number"
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              min={5}
              className={inputClass}
            />
          </div>

          {/* Separator */}
          <div className="h-px bg-noc-border/50 my-2" />

          {/* Scale Mode */}
          <div>
            <label className="noc-label mb-1 block">Scale Mode</label>
            <select
              value={scaleMode}
              onChange={(e) => setScaleMode(e.target.value as "steps" | "gradient")}
              className={inputClass}
            >
              <option value="steps">Steps (fixed color per band)</option>
              <option value="gradient">Gradient (smooth interpolation)</option>
            </select>
          </div>

          {/* Color Scale Editor */}
          <div>
            <label className="noc-label mb-2 block">Color Scale</label>
            <div className="space-y-1.5">
              {bands.map((band, idx) => (
                <div key={idx} className="flex items-center gap-2">
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
