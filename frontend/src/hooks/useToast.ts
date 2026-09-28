import { create } from "zustand";
import { ApiError } from "@/api/client";

export type ToastVariant = "error" | "success";

export interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
}

interface ToastStore {
  toasts: Toast[];
  push: (variant: ToastVariant, message: string) => void;
  dismiss: (id: number) => void;
}

const MAX_TOASTS = 4;
const DISMISS_MS: Record<ToastVariant, number> = { error: 6000, success: 3000 };

let nextId = 1;

/** Tiny global toast queue — rendered by <ToastViewport />. */
export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (variant, message) => {
    const id = nextId++;
    // Collapse an identical toast that is still visible (e.g. a burst of
    // failing nudges) instead of stacking duplicates.
    const others = get().toasts.filter((t) => !(t.variant === variant && t.message === message));
    set({ toasts: [...others, { id, variant, message }].slice(-MAX_TOASTS) });
    setTimeout(() => get().dismiss(id), DISMISS_MS[variant]);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

/** Readable message for any thrown value, preferring the backend `detail`. */
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.detail ? `${fallback}: ${e.detail}` : `${fallback} (${e.message})`;
  if (e instanceof Error && e.message) return `${fallback}: ${e.message}`;
  return fallback;
}

/** Imperative helpers usable from stores, callbacks and components alike. */
export const toast = {
  error: (message: string) => useToastStore.getState().push("error", message),
  success: (message: string) => useToastStore.getState().push("success", message),
  /** Toast a caught error with a short context prefix ("Failed to align nodes"). */
  fromError: (e: unknown, fallback: string) =>
    useToastStore.getState().push("error", errorMessage(e, fallback)),
};
