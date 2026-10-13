import { useEffect, useState } from "react";

export interface KeyedResult<T> {
  data: T | null;
  error: string | null;
  /** A request is defined and no result exists yet for exactly this key. */
  loading: boolean;
}

/**
 * Run `run` whenever `key` changes and expose its result only while `key` is
 * still the current one. `key` must be referentially stable (useMemo): a
 * result is stored with the key it was fetched for, so switching link or
 * period can never show a stale chart, and late responses are ignored.
 */
export function useKeyedResult<K, T>(key: K, run: (() => Promise<T>) | null): KeyedResult<T> {
  const [result, setResult] = useState<{ key: K; data: T | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!run) return;
    let cancelled = false;
    run()
      .then((data) => {
        if (!cancelled) setResult({ key, data, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : "Unknown error";
          setResult({ key, data: null, error: message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key, run]);

  const current = run && result?.key === key ? result : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: run !== null && current === null,
  };
}
