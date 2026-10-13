import type { ScaleBand } from "@/types";

/**
 * The Ledger default traffic scale. Mirrors `DEFAULT_SCALE` in
 * backend/app/models/map.py — keep both in sync.
 * Normal load stays quiet; amber and red only from 70% / 90%, with a word.
 */
export const LEDGER_DEFAULT_SCALE: readonly ScaleBand[] = [
  { min: 0, max: 40, color: "@quiet", label: "0–40%" },
  { min: 40, max: 70, color: "@load", label: "40–70%" },
  { min: 70, max: 90, color: "@watch", label: "Watch ≥ 70%" },
  { min: 90, max: 100, color: "@incident", label: "Incident ≥ 90%" },
];
