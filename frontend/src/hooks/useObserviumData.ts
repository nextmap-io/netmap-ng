import { useState, useCallback, useRef } from "react";
import { api } from "@/api/client";
import type { ObserviumDevice, ObserviumPort } from "@/types";

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
      setDevices(data as unknown as ObserviumDevice[]);
      devicesFetched.current = true;
    } finally {
      setLoadingDevices(false);
    }
  }, []);

  const getDevicePorts = useCallback(async (deviceId: number): Promise<ObserviumPort[]> => {
    if (portsCache.current.has(deviceId)) {
      return portsCache.current.get(deviceId)!;
    }
    const data = await api.getDevicePorts(deviceId);
    const ports = data as unknown as ObserviumPort[];
    portsCache.current.set(deviceId, ports);
    return ports;
  }, []);

  return { devices, loadingDevices, fetchDevices, getDevicePorts };
}
