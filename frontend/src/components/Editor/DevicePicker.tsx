import { useState, useEffect, useRef, useMemo } from "react";
import { useObserviumData } from "@/hooks/useObserviumData";

const inputClass =
  "w-full bg-noc-bg text-xs text-noc-text rounded border border-noc-border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent/50";

interface DevicePickerProps {
  value: number | null;
  onChange: (deviceId: number | null) => void;
}

export function DevicePicker({ value, onChange }: DevicePickerProps) {
  const { devices, loadingDevices, fetchDevices } = useObserviumData();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const blurTimeout = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  // Resolve the currently selected device for display
  const selectedDevice = useMemo(
    () => (value != null ? devices.find((d) => d.device_id === value) : null),
    [devices, value],
  );

  // Sync the input text when the value or devices list changes
  useEffect(() => {
    if (!open) {
      setQuery(selectedDevice?.hostname ?? "");
    }
  }, [selectedDevice, open]);

  // Fetch devices on mount
  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  const filtered = useMemo(() => {
    if (!query) return devices;
    const q = query.toLowerCase();
    return devices.filter((d) => d.hostname.toLowerCase().includes(q));
  }, [devices, query]);

  const handleFocus = () => {
    fetchDevices();
    setOpen(true);
  };

  const handleBlur = () => {
    blurTimeout.current = setTimeout(() => setOpen(false), 150);
  };

  const handleSelect = (deviceId: number, hostname: string) => {
    clearTimeout(blurTimeout.current);
    setQuery(hostname);
    setOpen(false);
    onChange(deviceId);
  };

  const handleClear = () => {
    clearTimeout(blurTimeout.current);
    setQuery("");
    setOpen(false);
    onChange(null);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={loadingDevices ? "Loading devices..." : "Search device..."}
          className={inputClass}
        />
        {value != null && (
          <button
            type="button"
            onClick={handleClear}
            className="text-2xs text-accent hover:text-accent/80 whitespace-nowrap"
          >
            Clear
          </button>
        )}
      </div>

      {open && filtered.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-noc-card border border-noc-border rounded max-h-48 overflow-y-auto z-50">
          {filtered.map((device) => (
            <button
              key={device.device_id}
              type="button"
              onMouseDown={() => handleSelect(device.device_id, device.hostname)}
              className="w-full text-left px-2 py-1.5 hover:bg-noc-bg/60 transition-colors"
            >
              <div className="text-xs text-noc-text truncate">{device.hostname}</div>
              {device.hardware && (
                <div className="text-2xs text-noc-text-dim truncate">{device.hardware}</div>
              )}
            </button>
          ))}
        </div>
      )}

      {open && !loadingDevices && filtered.length === 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-noc-card border border-noc-border rounded z-50 px-2 py-2">
          <span className="text-2xs text-noc-text-dim">No devices found</span>
        </div>
      )}
    </div>
  );
}
