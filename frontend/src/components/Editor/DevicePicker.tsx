import { useState, useEffect, useRef, useMemo } from "react";
import { useObserviumData } from "@/hooks/useObserviumData";
import { INPUT, TEXT_ACTION } from "./ui";

const inputClass = INPUT;

interface DevicePickerProps {
  value: number | null;
  onChange: (deviceId: number | null) => void;
}

export function DevicePicker({ value, onChange }: DevicePickerProps) {
  const { devices, loadingDevices, fetchDevices } = useObserviumData();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const blurTimeout = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Resolve the currently selected device for display
  const selectedDevice = useMemo(
    () => (value != null ? devices.find((d) => d.device_id === value) : null),
    [devices, value],
  );

  // While closed, the input mirrors the selected device. Adjusted during render
  // (React's "adjust state when a prop changes" pattern) rather than in an
  // effect, which would render the stale text once first.
  const closedText = open ? null : (selectedDevice?.hostname ?? "");
  const [syncedText, setSyncedText] = useState<string | null | undefined>(undefined);
  if (closedText !== syncedText) {
    setSyncedText(closedText);
    if (closedText !== null) setQuery(closedText);
  }

  // Debounce the text used for filtering to avoid churning a long device list.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  // Fetch devices on mount
  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  const filtered = useMemo(() => {
    if (!debouncedQuery) return devices;
    const q = debouncedQuery.toLowerCase();
    return devices.filter((d) => d.hostname.toLowerCase().includes(q));
  }, [devices, debouncedQuery]);

  // Active option, kept in range as the filtered list shrinks.
  const activeIdx = Math.min(activeIndex, Math.max(0, filtered.length - 1));

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
      setActiveIndex(Math.min(activeIdx + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(Math.max(activeIdx - 1, 0));
    } else if (e.key === "Enter") {
      const d = filtered[activeIdx];
      if (d) {
        e.preventDefault();
        handleSelect(d.device_id, d.hostname);
      }
    }
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
            setActiveIndex(0);
          }}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-controls="device-picker-list"
          aria-autocomplete="list"
          placeholder={loadingDevices ? "Loading devices…" : "Search device…"}
          className={inputClass}
        />
        {value != null && (
          <button
            type="button"
            onClick={handleClear}
            className={`${TEXT_ACTION} whitespace-nowrap`}
          >
            Clear
          </button>
        )}
      </div>

      {open && filtered.length > 0 && (
        <div
          ref={listRef}
          id="device-picker-list"
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 bg-card border border-border rounded max-h-56 overflow-y-auto z-50"
        >
          {filtered.map((device, idx) => (
            <button
              key={device.device_id}
              type="button"
              role="option"
              aria-selected={idx === activeIdx}
              onMouseEnter={() => setActiveIndex(idx)}
              onMouseDown={() => handleSelect(device.device_id, device.hostname)}
              className={`w-full text-left px-2 py-1.5 transition-colors ${idx === activeIdx ? "bg-muted" : "hover:bg-muted"}`}
            >
              <div className="text-base text-foreground truncate">{device.hostname}</div>
              {device.hardware && (
                <div className="text-sm text-muted-foreground truncate">{device.hardware}</div>
              )}
            </button>
          ))}
        </div>
      )}

      {open && !loadingDevices && filtered.length === 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-card border border-border rounded z-50 px-2 py-2">
          <span className="text-sm text-muted-foreground">No device matches this search.</span>
        </div>
      )}
    </div>
  );
}
