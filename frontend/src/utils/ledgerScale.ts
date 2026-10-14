import type { ScaleBand } from "@/types";

/**
 * The Ledger default traffic scale. Mirrors `DEFAULT_SCALE` in
 * backend/app/models/map.py — keep both in sync.
 * Normal load stays quiet; amber and red only from 70% / 90%, with a word.
 */
export const LEDGER_DEFAULT_SCALE: readonly ScaleBand[] = [
  { min: 0, max: 1, color: "@level1", label: "0–1%" },
  { min: 1, max: 5, color: "@level2", label: "1–5%" },
  { min: 5, max: 15, color: "@level3", label: "5–15%" },
  { min: 15, max: 40, color: "@level4", label: "15–40%" },
  { min: 40, max: 70, color: "@level5", label: "40–70%" },
  { min: 70, max: 90, color: "@watch", label: "Watch ≥ 70%" },
  { min: 90, max: 100, color: "@incident", label: "Incident ≥ 90%" },
];
