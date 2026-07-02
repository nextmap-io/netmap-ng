import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useObserviumData } from "@/hooks/useObserviumData";
import type { ObserviumPort } from "@/types";

const inputClass =
  "w-full bg-noc-bg text-xs text-noc-text rounded border border-noc-border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent/50";

const labelClass = "noc-label mb-1";

function formatSpeed(speed: number): string {
  if (speed >= 1_000_000_000) return `${(speed / 1_000_000_000).toFixed(0)}G`;
  if (speed >= 1_000_000) return `${(speed / 1_000_000).toFixed(0)}M`;
  if (speed >= 1_000) return `${(speed / 1_000).toFixed(0)}K`;
  return `${speed}`;
}

interface PortPickerProps {
  deviceId: number | null;
  value: number | null;
  onChange: (portId: number | null) => void;
  label: string;
}

export function PortPicker({ deviceId, value, onChange, label }: PortPickerProps) {
  const { getDevicePorts } = useObserviumData();
  const [ports, setPorts] = useState<ObserviumPort[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const blurTimeout = useRef<ReturnType<typeof setTimeout>>();

  // Fetch ports when deviceId changes
  const fetchPorts = useCallback(async () => {
    if (deviceId == null) {
      setPorts([]);
      return;
    }
    setLoading(true);
    try {
      const data = await getDevicePorts(deviceId);
      setPorts(data);
    } finally {
      setLoading(false);
    }
  }, [deviceId, getDevicePorts]);

  useEffect(() => {
    fetchPorts();
  }, [fetchPorts]);

  // Resolve the currently selected port for display
  const selectedPort = useMemo(
    () => (value != null ? ports.find((p) => p.port_id === value) : null),
    [ports, value],
  );

  // Sync the input text when value or ports change
  useEffect(() => {
    if (!open) {
      setQuery(selectedPort?.ifName ?? "");
    }
  }, [selectedPort, open]);

  // Debounce filtering text.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  const filtered = useMemo(() => {
    if (!debouncedQuery) return ports;
    const q = debouncedQuery.toLowerCase();
    return ports.filter(
      (p) =>
        p.ifName.toLowerCase().includes(q) ||
        (p.ifAlias && p.ifAlias.toLowerCase().includes(q)),
    );
  }, [ports, debouncedQuery]);

  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered]);

  // A stored port id that isn't in the fetched port list means the underlying
  // device was rebound and the binding is stale (still used for traffic).
  const staleBinding =
    value != null && !loading && ports.length > 0 && !selectedPort;

  const handleFocus = () => {
    setOpen(true);
  };

  const handleBlur = () => {
    blurTimeout.current = setTimeout(() => setOpen(false), 150);
  };

  const handleSelect = (portId: number, ifName: string) => {
    clearTimeout(blurTimeout.current);
    setQuery(ifName);
    setOpen(false);
    onChange(portId);
  };

  const handleClear = () => {
    clearTimeout(blurTimeout.current);
    setQuery("");
    setOpen(false);
    onChange(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const p = filtered[activeIndex];
      if (p) {
        e.preventDefault();
        handleSelect(p.port_id, p.ifName);
      }
    }
  };

  const disabled = deviceId == null;

  return (
    <div>
      <label className={labelClass}>{label}</label>
      <div className="relative">
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={disabled ? "" : query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            placeholder={
              disabled
                ? "Select device first"
                : loading
                  ? "Loading ports..."
                  : "Search port..."
            }
            className={`${inputClass}${disabled ? " opacity-50 cursor-not-allowed" : ""}`}
          />
          {value != null && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="text-2xs text-accent hover:text-accent/80 whitespace-nowrap"
            >
              Clear
            </button>
          )}
        </div>

        {open && !disabled && filtered.length > 0 && (
          <div role="listbox" className="absolute left-0 right-0 top-full mt-1 bg-noc-card border border-noc-border rounded max-h-48 overflow-y-auto z-50">
            {filtered.map((port, idx) => (
              <button
                key={port.port_id}
                type="button"
                role="option"
                aria-selected={idx === activeIndex}
                onMouseEnter={() => setActiveIndex(idx)}
                onMouseDown={() => handleSelect(port.port_id, port.ifName)}
                className={`w-full text-left px-2 py-1.5 transition-colors ${idx === activeIndex ? "bg-noc-bg/60" : "hover:bg-noc-bg/60"}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-noc-text">{port.ifName}</span>
                  {port.ifSpeed > 0 && (
                    <span className="text-2xs text-noc-text-muted">
                      {formatSpeed(port.ifSpeed)}
                    </span>
                  )}
                </div>
                {port.ifAlias && (
                  <div className="text-2xs text-noc-text-dim truncate">{port.ifAlias}</div>
                )}
              </button>
            ))}
          </div>
        )}

        {open && !disabled && !loading && filtered.length === 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-noc-card border border-noc-border rounded z-50 px-2 py-2">
            <span className="text-2xs text-noc-text-dim">No ports found</span>
          </div>
        )}
      </div>
      {staleBinding && (
        <p className="mt-1 text-2xs text-node-firewall">
          Binding no longer valid for this device — pick a new port or clear it.
        </p>
      )}
    </div>
  );
}
