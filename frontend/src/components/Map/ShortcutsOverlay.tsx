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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="noc-card w-80 p-4 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="noc-label">Keyboard Shortcuts</span>
          <button
            onClick={onClose}
            className="text-noc-text-dim hover:text-noc-text transition-colors"
            aria-label="Close shortcuts"
          >
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <ul className="space-y-1.5">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-3">
              <span className="text-2xs text-noc-text-muted">{s.label}</span>
              <kbd className="text-2xs text-noc-text bg-noc-bg border border-noc-border rounded px-1.5 py-0.5 tabular-nums whitespace-nowrap">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
