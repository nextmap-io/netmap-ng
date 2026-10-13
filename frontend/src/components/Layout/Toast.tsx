import { useToastStore } from "@/hooks/useToast";

/**
 * Split an error message into a lead ("Couldn't save") and the reason.
 * Messages come as "Failed to <action>: <detail>" or "Failed to <action> (<status>)".
 */
function splitError(message: string): { lead: string; rest: string } {
  const m = /^Failed to (.+?)(?::\s*(.*)|\s+\((.*)\))?$/s.exec(message);
  if (m) {
    const reason = m[2] ?? m[3];
    return { lead: `Couldn't ${m[1]}`, rest: reason ? reason : "" };
  }
  return { lead: "Error", rest: message };
}

/**
 * Bottom-right toast stack on a floating card surface (follows dark/light/SCADA).
 * An error leads with a word in the incident color; a success stays neutral.
 */
export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-60 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const isError = t.variant === "error";
        const parts = isError ? splitError(t.message) : null;
        return (
          <div
            key={t.id}
            role={isError ? "alert" : "status"}
            className="pointer-events-auto rounded border border-border bg-card px-3 py-2 flex items-start gap-2"
          >
            <p className="flex-1 text-sm text-foreground wrap-break-word">
              {parts ? (
                <>
                  <span className="font-semibold text-destructive">{parts.lead}</span>
                  {parts.rest && <span className="text-foreground-secondary">. {parts.rest}</span>}
                </>
              ) : (
                t.message
              )}
            </p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 -mr-1 px-1 rounded text-base leading-5 text-muted-foreground hover:text-foreground transition-colors"
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
