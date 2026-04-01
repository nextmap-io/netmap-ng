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
  const [open, setOpen] = useState(false);
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

  const filtered = useMemo(() => {
    if (!query) return ports;
    const q = query.toLowerCase();
    return ports.filter(
      (p) =>
        p.ifName.toLowerCase().includes(q) ||
        (p.ifAlias && p.ifAlias.toLowerCase().includes(q)),
    );
  }, [ports, query]);

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
            disabled={disabled}
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
          <div className="absolute left-0 right-0 top-full mt-1 bg-noc-card border border-noc-border rounded max-h-48 overflow-y-auto z-50">
            {filtered.map((port) => (
              <button
                key={port.port_id}
                type="button"
                onMouseDown={() => handleSelect(port.port_id, port.ifName)}
                className="w-full text-left px-2 py-1.5 hover:bg-noc-bg/60 transition-colors"
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
    </div>
  );
}
