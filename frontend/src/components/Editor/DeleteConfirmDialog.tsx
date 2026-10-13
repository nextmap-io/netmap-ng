import { useEffect, useRef } from "react";
import { BACKDROP, BUTTON, BUTTON_DESTRUCTIVE, SURFACE, TITLE } from "./ui";

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
  // Latest handler refs — keep the keydown listener stable across renders.
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Only Escape is bound to a keyboard action — a stray Enter must NOT trigger
    // the destructive (and cascading) delete. Focus the non-destructive Cancel.
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancelRef.current();
    };
    window.addEventListener("keydown", handler);
    cancelButtonRef.current?.focus();
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  if (!open) return null;

  return (
    <div role="presentation" className={BACKDROP} onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-confirm-title"
        className={`${SURFACE} w-full max-w-sm`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-2">
          <h3 id="delete-confirm-title" className={TITLE}>
            {title}
          </h3>
        </div>

        {/* Body */}
        <div className="px-4 pb-4">
          <p className="text-base text-foreground-secondary">{message}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-4 pb-4">
          <button ref={cancelButtonRef} onClick={onCancel} className={BUTTON}>
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={BUTTON_DESTRUCTIVE}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
