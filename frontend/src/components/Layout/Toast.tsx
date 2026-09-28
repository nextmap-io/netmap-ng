import { useToastStore } from "@/hooks/useToast";

/**
 * Bottom-right toast stack. Uses the theme-aware `noc-glass` surface so it
 * follows dark/light/SCADA; the variant is carried by the accent bar + dot.
 */
export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const isError = t.variant === "error";
        return (
          <div
            key={t.id}
            role={isError ? "alert" : "status"}
            className={`pointer-events-auto noc-glass rounded border-l-2 px-3 py-2 shadow-lg animate-fade-in flex items-start gap-2 ${
              isError ? "border-l-node-firewall" : "border-l-node-server"
            }`}
          >
            <span
              className={`mt-1 w-1.5 h-1.5 shrink-0 rounded-full ${isError ? "bg-node-firewall" : "bg-node-server"}`}
            />
            <p className="flex-1 text-2xs text-noc-text leading-relaxed break-words">{t.message}</p>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 text-noc-text-dim hover:text-noc-text transition-colors text-xs leading-none"
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
