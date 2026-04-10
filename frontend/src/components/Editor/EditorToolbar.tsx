import { useState } from "react";
import { useMapStore } from "@/hooks/useMapStore";
import { LinkCreationDialog } from "./LinkCreationDialog";
import { MapSettingsDialog } from "./MapSettingsDialog";

export function EditorToolbar() {
  const {
    editMode,
    map,
    selectedNodeIds,
    alignNodes,
    distributeNodes,
    toggleSnapToGrid,
    snapToGrid,
    createLink,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useMapStore();

  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  if (!editMode) return null;

  const canAlign = selectedNodeIds.length >= 2;
  const canDistribute = selectedNodeIds.length >= 3;

  const btnBase =
    "p-1.5 rounded border border-transparent text-noc-text-muted hover:text-noc-text hover:bg-noc-surface transition-colors";
  const btnDisabled = "opacity-30 cursor-not-allowed";
  const btnActive = "!bg-accent/15 !text-accent !border-accent/20";

  function btn(
    enabled: boolean,
    onClick: () => void,
    icon: React.ReactNode,
    title: string,
    active?: boolean,
  ) {
    return (
      <button
        className={`${active ? btnActive : btnBase} ${!enabled ? btnDisabled : ""}`}
        style={{ width: 28, height: 28 }}
        onClick={enabled ? onClick : undefined}
        disabled={!enabled}
        title={title}
      >
        {icon}
      </button>
    );
  }

  const sep = <div className="h-4 w-px bg-noc-border/50" />;

  return (
    <>
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 noc-glass rounded flex items-center gap-0.5 px-1.5 py-1">
        {/* Group 1 - Alignment */}
        {btn(canAlign, () => alignNodes("left"), <IconAlignLeft />, "Align Left")}
        {btn(canAlign, () => alignNodes("center"), <IconAlignCenterH />, "Align Center Horizontal")}
        {btn(canAlign, () => alignNodes("right"), <IconAlignRight />, "Align Right")}
        {sep}
        {btn(canAlign, () => alignNodes("top"), <IconAlignTop />, "Align Top")}
        {btn(canAlign, () => alignNodes("middle"), <IconAlignMiddleV />, "Align Middle Vertical")}
        {btn(canAlign, () => alignNodes("bottom"), <IconAlignBottom />, "Align Bottom")}

        {/* Group 2 - Distribution */}
        {sep}
        {btn(canDistribute, () => distributeNodes("horizontal"), <IconDistributeH />, "Distribute Horizontal")}
        {btn(canDistribute, () => distributeNodes("vertical"), <IconDistributeV />, "Distribute Vertical")}

        {/* Group 3 - Undo/Redo */}
        {sep}
        {btn(canUndo, () => undo(), <IconUndo />, "Undo (Ctrl+Z)")}
        {btn(canRedo, () => redo(), <IconRedo />, "Redo (Ctrl+Shift+Z)")}

        {/* Group 4 - Canvas */}
        {sep}
        {btn(true, toggleSnapToGrid, <IconGrid />, "Snap to Grid", snapToGrid)}
        {btn(true, () => setShowSettings(true), <IconSettings />, "Map Settings")}
        {btn(true, () => setShowLinkDialog(true), <IconAddLink />, "Add Link")}
      </div>

      {map && (
        <LinkCreationDialog
          open={showLinkDialog}
          nodes={map.nodes}
          onClose={() => setShowLinkDialog(false)}
          onCreate={createLink}
        />
      )}
      <MapSettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
    </>
  );
}

/* ─── Inline SVG Icons (16x16 viewBox) ─── */

function IconAlignLeft() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <line x1={2} y1={2} x2={2} y2={14} />
      <rect x={4} y={3} width={8} height={2} rx={0.5} fill="currentColor" stroke="none" />
      <rect x={4} y={7} width={10} height={2} rx={0.5} fill="currentColor" stroke="none" />
      <rect x={4} y={11} width={6} height={2} rx={0.5} fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconAlignCenterH() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <line x1={8} y1={1} x2={8} y2={15} strokeDasharray="1.5 1.5" strokeOpacity={0.5} />
      <rect x={4} y={3} width={8} height={2} rx={0.5} fill="currentColor" stroke="none" />
      <rect x={3} y={7} width={10} height={2} rx={0.5} fill="currentColor" stroke="none" />
      <rect x={5} y={11} width={6} height={2} rx={0.5} fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconAlignRight() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <line x1={14} y1={2} x2={14} y2={14} />
      <rect x={4} y={3} width={8} height={2} rx={0.5} fill="currentColor" stroke="none" />
      <rect x={2} y={7} width={10} height={2} rx={0.5} fill="currentColor" stroke="none" />
      <rect x={6} y={11} width={6} height={2} rx={0.5} fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconAlignTop() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <line x1={2} y1={2} x2={14} y2={2} />
      <rect x={3} y={4} width={2} height={8} rx={0.5} fill="currentColor" stroke="none" />
      <rect x={7} y={4} width={2} height={10} rx={0.5} fill="currentColor" stroke="none" />
      <rect x={11} y={4} width={2} height={6} rx={0.5} fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconAlignMiddleV() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <line x1={1} y1={8} x2={15} y2={8} strokeDasharray="1.5 1.5" strokeOpacity={0.5} />
      <rect x={3} y={4} width={2} height={8} rx={0.5} fill="currentColor" stroke="none" />
      <rect x={7} y={3} width={2} height={10} rx={0.5} fill="currentColor" stroke="none" />
      <rect x={11} y={5} width={2} height={6} rx={0.5} fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconAlignBottom() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <line x1={2} y1={14} x2={14} y2={14} />
      <rect x={3} y={4} width={2} height={8} rx={0.5} fill="currentColor" stroke="none" />
      <rect x={7} y={2} width={2} height={10} rx={0.5} fill="currentColor" stroke="none" />
      <rect x={11} y={6} width={2} height={6} rx={0.5} fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconDistributeH() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <line x1={1} y1={2} x2={1} y2={14} strokeOpacity={0.4} />
      <line x1={15} y1={2} x2={15} y2={14} strokeOpacity={0.4} />
      <rect x={3} y={5} width={2} height={6} rx={0.5} fill="currentColor" stroke="none" />
      <rect x={7} y={5} width={2} height={6} rx={0.5} fill="currentColor" stroke="none" />
      <rect x={11} y={5} width={2} height={6} rx={0.5} fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconDistributeV() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <line x1={2} y1={1} x2={14} y2={1} strokeOpacity={0.4} />
      <line x1={2} y1={15} x2={14} y2={15} strokeOpacity={0.4} />
      <rect x={5} y={3} width={6} height={2} rx={0.5} fill="currentColor" stroke="none" />
      <rect x={5} y={7} width={6} height={2} rx={0.5} fill="currentColor" stroke="none" />
      <rect x={5} y={11} width={6} height={2} rx={0.5} fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconGrid() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1}>
      <line x1={4} y1={1} x2={4} y2={15} strokeOpacity={0.5} />
      <line x1={8} y1={1} x2={8} y2={15} strokeOpacity={0.5} />
      <line x1={12} y1={1} x2={12} y2={15} strokeOpacity={0.5} />
      <line x1={1} y1={4} x2={15} y2={4} strokeOpacity={0.5} />
      <line x1={1} y1={8} x2={15} y2={8} strokeOpacity={0.5} />
      <line x1={1} y1={12} x2={15} y2={12} strokeOpacity={0.5} />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.2}>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.9 2.9l1.4 1.4M11.7 11.7l1.4 1.4M2.9 13.1l1.4-1.4M11.7 4.3l1.4-1.4" />
    </svg>
  );
}

function IconAddLink() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
      <line x1={4} y1={12} x2={12} y2={4} />
      <circle cx={3} cy={13} r={2} />
      <circle cx={13} cy={3} r={2} />
    </svg>
  );
}

function IconUndo() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6l-3 3 3 3" />
      <path d="M1 9h9a4 4 0 0 1 0 8H8" />
    </svg>
  );
}

function IconRedo() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 6l3 3-3 3" />
      <path d="M15 9H6a4 4 0 0 0 0 8h2" />
    </svg>
  );
}
