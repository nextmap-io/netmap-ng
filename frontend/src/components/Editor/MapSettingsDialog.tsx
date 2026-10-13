import { useState } from "react";
import { api } from "@/api/client";
import { useMapStore } from "@/hooks/useMapStore";
import { useTheme } from "@/hooks/useTheme";
import type { ScaleBand } from "@/types";
import { COLOR_TOKENS, isColorToken, resolveColor } from "@/utils/scaleColor";
import { LEDGER_DEFAULT_SCALE } from "@/utils/ledgerScale";
import { FormField } from "./FormField";
import {
  BACKDROP,
  BLOCK,
  BLOCK_TITLE,
  BUTTON,
  BUTTON_PRIMARY,
  BUTTON_SM,
  COLOR_INPUT,
  HINT,
  INPUT,
  LABEL,
  SURFACE,
  TEXT_ACTION,
  TITLE,
} from "./ui";

interface MapSettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

type LocalBand = ScaleBand & { _key: string };

let bandKeyCounter = 0;
const nextBandKey = () => `band-${++bandKeyCounter}`;

const CUSTOM = "custom";
const HEX_RE = /^#[0-9a-f]{6}$/i;

/** A value safe for <input type="color"> (never a "@token"). */
function toHex(color: string): string {
  const resolved = resolveColor(color);
  if (HEX_RE.test(resolved)) return resolved.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(resolved)) {
    const [r, g, b] = resolved.slice(1);
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return "#888888";
}

const CHECKBOX_STYLE = { accentColor: "var(--color-foreground)" };

export function MapSettingsDialog({ open, onClose }: MapSettingsDialogProps) {
  const { map, loadMap } = useMapStore();
  // Swatches resolve "@tokens" against the painted theme: re-render on change.
  const { resolvedTheme } = useTheme();

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

  // Load the form from the map when the dialog opens, and again if the map
  // changes while it is open (adjusted during render instead of an effect).
  const formSource = open ? map : null;
  const [loadedFrom, setLoadedFrom] = useState<typeof map>(null);
  if (formSource !== loadedFrom) {
    setLoadedFrom(formSource);
    if (formSource) {
      const map = formSource;
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
  }

  if (!open || !map) return null;

  const inputClass = INPUT;

  const handleBandChange = (idx: number, field: keyof ScaleBand, value: string | number) => {
    setBands((prev) =>
      prev.map((b, i) => (i === idx ? { ...b, [field]: value } : b)),
    );
  };

  /** Token picked from the select, or "custom" (keeps the current look as hex). */
  const handleBandColorChoice = (idx: number, choice: string) => {
    const current = bands[idx]?.color ?? "";
    if (choice === CUSTOM) {
      if (isColorToken(current)) handleBandChange(idx, "color", toHex(current));
      return;
    }
    handleBandChange(idx, "color", choice);
  };

  const handleAddBand = () => {
    const lastMax = bands.length > 0 ? bands[bands.length - 1].max : 0;
    setBands((prev) => [
      ...prev,
      { min: lastMax, max: lastMax + 10, color: "@load", label: "", _key: nextBandKey() },
    ]);
  };

  const handleDeleteBand = (idx: number) => {
    setBands((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleResetScale = () => {
    setBands(LEDGER_DEFAULT_SCALE.map((b) => ({ ...b, _key: nextBandKey() })));
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
      setError(e instanceof Error && e.message ? e.message : "the server rejected the request.");
    } finally {
      setSaving(false);
    }
  };

  const shareUrl = publicToken ? `${window.location.origin}/public/${publicToken}` : "";

  return (
    <div role="presentation" className={BACKDROP} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="map-settings-title"
        className={`${SURFACE} w-full max-w-xl max-h-[90vh] overflow-y-auto p-4`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 id="map-settings-title" className={TITLE}>
            Map settings
          </h2>
          <button
            onClick={onClose}
            aria-label="Close map settings"
            title="Close"
            className="w-7 h-7 inline-flex items-center justify-center rounded text-foreground-secondary hover:bg-muted hover:text-foreground transition-colors"
          >
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          {/* General */}
          <section className={`${BLOCK} space-y-3`}>
            <h3 className={BLOCK_TITLE}>General</h3>
            <FormField label="Map name">
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

            <FormField label="Refresh interval (seconds)">
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
          </section>

          {/* Sharing */}
          <section className={`${BLOCK} space-y-3`}>
            <h3 className={BLOCK_TITLE}>Sharing</h3>
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
              <div className="space-y-3">
                {publicToken ? (
                  <FormField label="Share link">
                    {(id) => (
                      <div className="flex items-center gap-2">
                        <input
                          id={id}
                          type="text"
                          readOnly
                          value={shareUrl}
                          className="w-full px-2 py-1.5 font-mono text-sm text-foreground bg-background border border-border rounded"
                          onClick={(e) => (e.target as HTMLInputElement).select()}
                        />
                        <button
                          onClick={() => copyToClipboard(shareUrl)}
                          className={`${BUTTON_SM} shrink-0`}
                        >
                          {copied ? "Copied" : "Copy"}
                        </button>
                      </div>
                    )}
                  </FormField>
                ) : (
                  <p className={HINT}>Save to generate the public share link.</p>
                )}
                <fieldset>
                  <legend className={LABEL}>What the public link shows</legend>
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-2 text-base text-foreground">
                      <input type="checkbox" checked={showPercentage} onChange={(e) => setShowPercentage(e.target.checked)} style={CHECKBOX_STYLE} />
                      Utilization %
                    </label>
                    <label className="flex items-center gap-2 text-base text-foreground">
                      <input type="checkbox" checked={showBandwidth} onChange={(e) => setShowBandwidth(e.target.checked)} style={CHECKBOX_STYLE} />
                      Link capacity (10G, 40G…)
                    </label>
                    <label className="flex items-center gap-2 text-base text-foreground">
                      <input type="checkbox" checked={showBps} onChange={(e) => setShowBps(e.target.checked)} style={CHECKBOX_STYLE} />
                      Traffic in bps
                    </label>
                    <label className="flex items-center gap-2 text-base text-foreground">
                      <input type="checkbox" checked={showGraph} onChange={(e) => setShowGraph(e.target.checked)} style={CHECKBOX_STYLE} />
                      Traffic history graphs
                    </label>
                  </div>
                </fieldset>
              </div>
            )}
          </section>

          {/* Traffic scale */}
          <section className={`${BLOCK} space-y-3`} data-resolved-theme={resolvedTheme}>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className={BLOCK_TITLE}>Traffic scale</h3>
              <button type="button" onClick={handleResetScale} className={TEXT_ACTION}>
                Reset to Ledger default
              </button>
            </div>
            <p className={HINT}>
              Link color by utilization. Theme colors follow light, dark and SCADA; keep normal load quiet and
              use Watch and Incident only for abnormal load.
            </p>

            <FormField label="Mode">
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

            <div>
              <div className="hidden sm:grid grid-cols-[1fr_4rem_4rem_1fr_1.75rem] gap-2 mb-1 text-sm text-muted-foreground">
                <span>Color</span>
                <span>From %</span>
                <span>To %</span>
                <span>Label</span>
                <span />
              </div>
              <ul className="divide-y divide-border-soft">
                {bands.map((band, idx) => {
                  const token = isColorToken(band.color);
                  const known = token && band.color in COLOR_TOKENS;
                  return (
                    <li
                      key={band._key}
                      className="grid grid-cols-[4rem_4rem_1fr_1.75rem] sm:grid-cols-[1fr_4rem_4rem_1fr_1.75rem] items-center gap-2 py-1.5"
                    >
                      <div className="col-span-4 sm:col-span-1 flex items-center gap-2 min-w-0">
                        <span
                          aria-hidden="true"
                          className="w-6 h-6 shrink-0 rounded border border-border"
                          style={{ background: resolveColor(band.color) }}
                        />
                        <select
                          value={token ? band.color : CUSTOM}
                          onChange={(e) => handleBandColorChoice(idx, e.target.value)}
                          aria-label={`Band ${idx + 1} color`}
                          className={`${inputClass} min-w-0`}
                        >
                          {Object.entries(COLOR_TOKENS).map(([value, t]) => (
                            <option key={value} value={value}>
                              {t.label}
                            </option>
                          ))}
                          {token && !known && <option value={band.color}>{band.color}</option>}
                          <option value={CUSTOM}>Custom…</option>
                        </select>
                        {!token && (
                          <input
                            type="color"
                            value={toHex(band.color)}
                            onChange={(e) => handleBandChange(idx, "color", e.target.value)}
                            aria-label={`Band ${idx + 1} custom color`}
                            className={`${COLOR_INPUT} shrink-0`}
                          />
                        )}
                      </div>
                      <input
                        type="number"
                        value={band.min}
                        onChange={(e) => handleBandChange(idx, "min", Number(e.target.value))}
                        className={inputClass}
                        aria-label={`Band ${idx + 1} from %`}
                        title="From %"
                      />
                      <input
                        type="number"
                        value={band.max}
                        onChange={(e) => handleBandChange(idx, "max", Number(e.target.value))}
                        className={inputClass}
                        aria-label={`Band ${idx + 1} to %`}
                        title="To %"
                      />
                      <input
                        type="text"
                        value={band.label}
                        onChange={(e) => handleBandChange(idx, "label", e.target.value)}
                        placeholder="Label"
                        aria-label={`Band ${idx + 1} label`}
                        className={`${inputClass} min-w-0`}
                      />
                      <button
                        onClick={() => handleDeleteBand(idx)}
                        className="w-7 h-7 inline-flex items-center justify-center rounded text-foreground-secondary hover:bg-muted hover:text-destructive transition-colors"
                        title="Remove band"
                        aria-label={`Remove band ${idx + 1}`}
                      >
                        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5}>
                          <path d="M4 4l8 8M12 4l-8 8" />
                        </svg>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {bands.length === 0 && (
                <p className={HINT}>No bands: links draw in the muted color. Add a band or reset to the Ledger default.</p>
              )}
              <button onClick={handleAddBand} className={`${BUTTON_SM} mt-2`}>
                Add band
              </button>
            </div>
          </section>
        </div>

        {/* Footer */}
        {error && (
          <p role="alert" className="mt-4 text-sm text-foreground-secondary">
            <span className="font-medium text-destructive">Couldn&apos;t save the settings</span>: {error}
          </p>
        )}
        <div className="flex justify-end gap-2 mt-5 pt-3 border-t border-border">
          <button onClick={onClose} className={BUTTON}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} className={BUTTON_PRIMARY}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
