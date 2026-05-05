import { useState, useCallback, useRef } from "react";
import { api } from "@/api/client";
import { logError } from "@/lib/log";
import type { ObserviumDevice, ObserviumPort } from "@/types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Validate a raw object against ObserviumDevice. Returns null if any required field is wrong. */
function validateDevice(raw: unknown): ObserviumDevice | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.device_id !== "number") return null;
  if (typeof raw.hostname !== "string") return null;
  // tolerate missing optional-ish fields by coercing to safe defaults
  return {
    device_id: raw.device_id,
    hostname: raw.hostname,
    sysName: typeof raw.sysName === "string" ? raw.sysName : "",
    os: typeof raw.os === "string" ? raw.os : "",
    hardware: typeof raw.hardware === "string" ? raw.hardware : "",
    location: typeof raw.location === "string" ? raw.location : "",
    status: typeof raw.status === "number" ? raw.status : 0,
    type: typeof raw.type === "string" ? raw.type : "",
  };
}

/** Validate a raw object against ObserviumPort. Returns null on mismatch. */
function validatePort(raw: unknown): ObserviumPort | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.port_id !== "number") return null;
  return {
    port_id: raw.port_id,
    ifIndex: typeof raw.ifIndex === "number" ? raw.ifIndex : 0,
    ifName: typeof raw.ifName === "string" ? raw.ifName : "",
    ifDescr: typeof raw.ifDescr === "string" ? raw.ifDescr : "",
    ifAlias: typeof raw.ifAlias === "string" ? raw.ifAlias : "",
    ifSpeed: typeof raw.ifSpeed === "number" ? raw.ifSpeed : 0,
    ifOperStatus: typeof raw.ifOperStatus === "string" ? raw.ifOperStatus : "",
    port_label_short:
      typeof raw.port_label_short === "string" ? raw.port_label_short : "",
  };
}

function validateDevices(raw: unknown[]): ObserviumDevice[] {
  const out: ObserviumDevice[] = [];
  for (const item of raw) {
    const d = validateDevice(item);
    if (d) out.push(d);
    else logError("Invalid Observium device payload", { item });
  }
  return out;
}

function validatePorts(raw: unknown[]): ObserviumPort[] {
  const out: ObserviumPort[] = [];
  for (const item of raw) {
    const p = validatePort(item);
    if (p) out.push(p);
    else logError("Invalid Observium port payload", { item });
  }
  return out;
}

export function useObserviumData() {
  const [devices, setDevices] = useState<ObserviumDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const devicesFetched = useRef(false);
  const portsCache = useRef<Map<number, ObserviumPort[]>>(new Map());

  const fetchDevices = useCallback(async () => {
    if (devicesFetched.current) return;
    setLoadingDevices(true);
    try {
      const data = await api.getObserviumDevices();
      setDevices(validateDevices(data));
      devicesFetched.current = true;
    } catch (err) {
      logError(err, { where: "fetchDevices" });
    } finally {
      setLoadingDevices(false);
    }
  }, []);

  const getDevicePorts = useCallback(
    async (deviceId: number): Promise<ObserviumPort[]> => {
      const cached = portsCache.current.get(deviceId);
      if (cached) return cached;
      const data = await api.getDevicePorts(deviceId);
      const ports = validatePorts(data);
      portsCache.current.set(deviceId, ports);
      return ports;
    },
    [],
  );

  return { devices, loadingDevices, fetchDevices, getDevicePorts };
}
