/**
 * Shared Ledger class strings for the editor (see docs/DESIGN.md).
 * Floating surfaces: bg-card + 1px rule + 4px radius, no shadow, no blur.
 */

/** Field label: 13px tertiary, sentence case. */
export const LABEL = "block mb-1 text-sm text-muted-foreground";

/** Block title inside a panel or dialog: 13px/600, sentence case. */
export const BLOCK_TITLE = "mb-2 text-sm font-semibold text-foreground";

/** A block separated from the previous one by a 1px rule (no box). */
export const BLOCK = "border-t border-border pt-3 first:border-t-0 first:pt-0";

/** Stack of blocks inside the property panel. */
export const STACK = "space-y-3";

/** Inline label of a toggle / color row (13px tertiary). */
export const ROW_LABEL = "text-sm text-muted-foreground";

/** Native color input. Never give it a "@token" value. */
export const COLOR_INPUT = "w-8 h-6 p-0 rounded border border-border bg-background cursor-pointer";

/** Small text action ("Reset", "Clear"). */
export const TEXT_ACTION = "text-sm text-link hover:underline";

/** Pressable chip (B / I, segmented choices): neutral, cobalt text when on. */
export function pressClass(on: boolean): string {
  return `px-2 py-1 text-sm rounded border border-border transition-colors ${
    on ? "bg-muted text-link" : "bg-background text-foreground-secondary hover:bg-muted hover:text-foreground"
  }`;
}

/** Switch track / thumb: ink when on, quiet when off. */
export function switchTrack(on: boolean): string {
  return `relative inline-flex h-4 w-8 shrink-0 items-center rounded-full border transition-colors ${
    on ? "bg-foreground border-foreground" : "bg-muted border-border"
  }`;
}
export function switchThumb(on: boolean): string {
  return `inline-block h-3 w-3 rounded-full transition-transform ${
    on ? "translate-x-4 bg-background" : "translate-x-0.5 bg-muted-foreground"
  }`;
}

/** Panel / dialog title: 15px/600. */
export const TITLE = "text-lg font-semibold text-foreground";

/** Text inputs and selects: 14px, 4px radius, rule border, page ground. */
export const INPUT =
  "w-full px-2 py-1.5 text-base text-foreground bg-background border border-border rounded " +
  "placeholder:text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed";

/** Neutral bordered button. */
export const BUTTON =
  "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium text-foreground " +
  "bg-background border border-border rounded hover:bg-muted transition-colors " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

/** Compact neutral button (inline actions inside a block). */
export const BUTTON_SM =
  "inline-flex items-center justify-center gap-1 px-2 py-1 text-sm text-foreground " +
  "bg-background border border-border rounded hover:bg-muted transition-colors " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

/** Primary action: solid ink. */
export const BUTTON_PRIMARY =
  "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium text-background " +
  "bg-foreground border border-foreground rounded hover:opacity-90 transition-opacity " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

/** Destructive action (always carries the word, e.g. "Delete"). */
export const BUTTON_DESTRUCTIVE =
  "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium text-on-destructive " +
  "bg-destructive border border-destructive rounded hover:opacity-90 transition-opacity " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

/** Floating surface (dialogs, popovers, lists). */
export const SURFACE = "bg-card border border-border rounded";

/** Modal backdrop: plain semi-transparent ground, no blur. */
export const BACKDROP = "fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/70";

/** Help / hint text. */
export const HINT = "text-sm text-muted-foreground";
