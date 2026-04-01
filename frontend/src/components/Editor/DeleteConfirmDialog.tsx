interface DeleteConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
}: DeleteConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="noc-card rounded-lg shadow-lg w-80 animate-fade-in">
        {/* Header */}
        <div className="px-4 pt-4 pb-2">
          <h3 className="text-xs font-semibold text-noc-text">{title}</h3>
        </div>

        {/* Body */}
        <div className="px-4 pb-4">
          <p className="text-2xs text-noc-text-muted leading-relaxed">{message}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-4 pb-4">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-2xs font-medium text-noc-text-muted bg-noc-bg border border-noc-border rounded hover:bg-noc-surface transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-2xs font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
