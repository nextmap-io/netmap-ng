interface ShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: "?", label: "Toggle this help" },
  { keys: "Ctrl/⌘ + A", label: "Select all nodes" },
  { keys: "Ctrl/⌘ + D", label: "Duplicate selection" },
  { keys: "Ctrl/⌘ + Z", label: "Undo" },
  { keys: "Ctrl/⌘ + Shift + Z", label: "Redo" },
  { keys: "Delete / Backspace", label: "Delete selection" },
  { keys: "Arrow keys", label: "Nudge selection (1px)" },
  { keys: "Shift + Arrows", label: "Nudge selection (10px)" },
  { keys: "Esc", label: "Deselect / close" },
  { keys: "Shift + click", label: "Add/remove from selection" },
];

export function ShortcutsOverlay({ open, onClose }: ShortcutsOverlayProps) {
  if (!open) return null;
  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="w-full max-w-sm rounded border border-border bg-card p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 id="shortcuts-title" className="text-lg font-semibold text-foreground">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close shortcuts"
          >
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <dl>
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between gap-3 py-1.5 border-t border-border-soft">
              <dt className="text-sm text-foreground-secondary">{s.label}</dt>
              <dd>
                <kbd className="font-mono text-xs text-foreground bg-background border border-border rounded px-1.5 py-0.5 whitespace-nowrap">
                  {s.keys}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
