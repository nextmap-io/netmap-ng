import { useEffect, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import type { MapNode } from "@/types";
import { useMapStore } from "@/hooks/useMapStore";
import { useTheme } from "@/hooks/useTheme";
import { computeAutoLayout, type LayoutAlgorithm } from "@/utils/autoLayout";
import { exportMapToPng } from "@/utils/exportImage";
import { LinkCreationDialog } from "./LinkCreationDialog";
import { MapSettingsDialog } from "./MapSettingsDialog";

const SEPARATOR = <div className="h-4 w-px bg-noc-border/50" />;

function exportBgColor(theme: string): string {
  if (theme === "light") return "#f4f1ec";
  if (theme === "scada") return "#0a0a0a";
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "#0b0e14" : "#f4f1ec";
  }
  return "#0b0e14";
}

export function EditorToolbar() {
  const {
    editMode,
    map,
    selectedNodeIds,
    alignNodes,
    alignToCanvas,
    matchNodeSize,
    distributeNodes,
    flipNodes,
    toggleSnapToGrid,
    snapToGrid,
    toggleSelectMode,
    selectMode,
    createLink,
    undo,
    redo,
    canUndo,
    canRedo,
    bindSelectedNodes,
    unbindSelectedNodes,
    getBoundGroup,
    applyNodePositions,
  } = useMapStore();
  const { theme } = useTheme();
  const flow = useReactFlow();

  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const layoutMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!layoutMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (layoutMenuRef.current && !layoutMenuRef.current.contains(e.target as Node)) {
        setLayoutMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [layoutMenuOpen]);

  async function runAutoLayout(algorithm: LayoutAlgorithm) {
    setLayoutMenuOpen(false);
    if (!map || busy) return;
    setBusy(true);
    try {
      // Targets: current selection if any, else all nodes; locked nodes excluded.
      const locked = (n: MapNode) => n.locked || !!n.style?.locked;
      const byId = new Map(map.nodes.map((n) => [n.id, n]));
      const targetIds = new Set(
        (selectedNodeIds.length > 0
          ? map.nodes.filter((n) => selectedNodeIds.includes(n.id))
          : map.nodes
        )
          .filter((n) => !locked(n))
          .map((n) => n.id),
      );
      if (targetIds.size === 0) return;
      // ELK returns child coordinates relative to the parent group. Applying a
      // selected child while its parent stays put misplaces it, so pull each
      // selected child's (unlocked) parent group into the target set too; if the
      // parent is locked, drop the child instead of misplacing it.
      for (const id of [...targetIds]) {
        const n = byId.get(id);
        const parent = n?.parent_id ? byId.get(n.parent_id) : undefined;
        if (parent && parent.node_type === "group") {
          if (locked(parent)) targetIds.delete(id);
          else targetIds.add(parent.id);
        }
      }
      if (targetIds.size === 0) return;
      // Lay out the full graph (keeps group hierarchy correct), apply only targets.
      const positions = await computeAutoLayout(map.nodes, map.links, algorithm);
      const toApply = positions.filter((p) => targetIds.has(p.id));
      await applyNodePositions(toApply);
      flow.fitView({ duration: 500, padding: 0.12 });
    } catch (err) {
      console.error("Auto-layout failed:", err);
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    if (!map || busy) return;
    setBusy(true);
    try {
      await exportMapToPng(flow.getNodes(), map.name, exportBgColor(theme));
    } catch (err) {
      console.error("PNG export failed:", err);
    } finally {
      setBusy(false);
    }
  }

  if (!editMode) return null;

  const canAlign = selectedNodeIds.length >= 2;
  const canCanvas = selectedNodeIds.length >= 1;
  const canDistribute = selectedNodeIds.length >= 3;
  const canBind = selectedNodeIds.length >= 2;
  const isBound = selectedNodeIds.length > 0 && selectedNodeIds.some((id) => getBoundGroup(id));

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

  return (
    <>
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 noc-glass rounded flex items-center gap-0.5 px-1.5 py-1">
        {/* Group 1 - Alignment */}
        {btn(canAlign, () => alignNodes("left"), <IconAlignLeft />, "Align Left")}
        {btn(canAlign, () => alignNodes("center"), <IconAlignCenterH />, "Align Center Horizontal")}
        {btn(canAlign, () => alignNodes("right"), <IconAlignRight />, "Align Right")}
        {SEPARATOR}
        {btn(canAlign, () => alignNodes("top"), <IconAlignTop />, "Align Top")}
        {btn(canAlign, () => alignNodes("middle"), <IconAlignMiddleV />, "Align Middle Vertical")}
        {btn(canAlign, () => alignNodes("bottom"), <IconAlignBottom />, "Align Bottom")}

        {/* Group 2 - Distribution */}
        {SEPARATOR}
        {btn(canDistribute, () => distributeNodes("horizontal"), <IconDistributeH />, "Distribute Horizontal (equal edge gaps)")}
        {btn(canDistribute, () => distributeNodes("vertical"), <IconDistributeV />, "Distribute Vertical (equal edge gaps)")}

        {/* Group 3 - Canvas align & match size */}
        {SEPARATOR}
        {btn(canCanvas, () => alignToCanvas("horizontal"), <IconCanvasH />, "Center on canvas (horizontal)")}
        {btn(canCanvas, () => alignToCanvas("vertical"), <IconCanvasV />, "Center on canvas (vertical)")}
        {btn(canAlign, () => matchNodeSize("width"), <IconMatchW />, "Match width")}
        {btn(canAlign, () => matchNodeSize("height"), <IconMatchH />, "Match height")}

        {/* Group 4 - Flip / Mirror */}
        {SEPARATOR}
        {btn(canAlign, () => flipNodes("horizontal"), <IconFlipH />, "Flip Horizontal")}
        {btn(canAlign, () => flipNodes("vertical"), <IconFlipV />, "Flip Vertical")}

        {/* Group 4 - Bind */}
        {SEPARATOR}
        {btn(canBind, () => bindSelectedNodes(), <IconBind />, "Bind (move together)")}
        {btn(isBound, () => unbindSelectedNodes(), <IconUnbind />, "Unbind")}

        {/* Group 5 - Undo/Redo */}
        {SEPARATOR}
        {btn(canUndo, () => undo(), <IconUndo />, "Undo (Ctrl+Z)")}
        {btn(canRedo, () => redo(), <IconRedo />, "Redo (Ctrl+Shift+Z)")}

        {/* Group 6 - Auto-layout & Export */}
        {SEPARATOR}
        <div className="relative" ref={layoutMenuRef}>
          {btn(
            !busy,
            () => setLayoutMenuOpen((o) => !o),
            <IconLayout />,
            "Auto-layout",
            layoutMenuOpen,
          )}
          {layoutMenuOpen && (
            <div className="absolute top-9 left-0 z-30 noc-glass rounded py-1 min-w-[140px]">
              <button
                className="w-full text-left px-3 py-1.5 text-2xs text-noc-text hover:bg-noc-surface transition-colors"
                onClick={() => runAutoLayout("force")}
              >
                Organique
              </button>
              <button
                className="w-full text-left px-3 py-1.5 text-2xs text-noc-text hover:bg-noc-surface transition-colors"
                onClick={() => runAutoLayout("layered")}
              >
                Hiérarchique
              </button>
            </div>
          )}
        </div>
        {btn(!busy, handleExport, <IconExport />, "Export PNG")}

        {/* Group 7 - Canvas */}
        {SEPARATOR}
        {btn(true, toggleSelectMode, <IconSelect />, "Select Mode (drag to select)", selectMode)}
        {btn(true, toggleSnapToGrid, <IconGrid />, "Snap to Grid", snapToGrid)}
        {btn(true, () => setShowSettings(true), <IconSettings />, "Map Settings")}
        {btn(true, () => setShowLinkDialog(true), <IconAddLink />, "Add Link")}
      </div>

      {map && (
        <LinkCreationDialog
          open={showLinkDialog}
          nodes={map.nodes}
          existingLinks={map.links}
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

function IconCanvasH() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x={1.5} y={2} width={13} height={12} rx={1} strokeOpacity={0.4} />
      <line x1={8} y1={2} x2={8} y2={14} strokeDasharray="1.5 1.5" strokeOpacity={0.6} />
      <rect x={5} y={6} width={6} height={4} rx={0.5} fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconCanvasV() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x={2} y={1.5} width={12} height={13} rx={1} strokeOpacity={0.4} />
      <line x1={2} y1={8} x2={14} y2={8} strokeDasharray="1.5 1.5" strokeOpacity={0.6} />
      <rect x={6} y={5} width={4} height={6} rx={0.5} fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconMatchW() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
      <rect x={2} y={3} width={12} height={3} rx={0.5} fill="currentColor" stroke="none" />
      <rect x={2} y={10} width={12} height={3} rx={0.5} fill="currentColor" stroke="none" opacity={0.5} />
      <path d="M1 8h14M2.5 6.5L1 8l1.5 1.5M13.5 6.5L15 8l-1.5 1.5" />
    </svg>
  );
}

function IconMatchH() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
      <rect x={3} y={2} width={3} height={12} rx={0.5} fill="currentColor" stroke="none" />
      <rect x={10} y={2} width={3} height={12} rx={0.5} fill="currentColor" stroke="none" opacity={0.5} />
      <path d="M8 1v14M6.5 2.5L8 1l1.5 1.5M6.5 13.5L8 15l1.5-1.5" />
    </svg>
  );
}

function IconFlipH() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <line x1={8} y1={1} x2={8} y2={15} strokeDasharray="2 2" strokeOpacity={0.4} />
      <path d="M5 4L2 8l3 4" />
      <path d="M11 4l3 4-3 4" />
    </svg>
  );
}

function IconFlipV() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <line x1={1} y1={8} x2={15} y2={8} strokeDasharray="2 2" strokeOpacity={0.4} />
      <path d="M4 5L8 2l4 3" />
      <path d="M4 11l4 3 4-3" />
    </svg>
  );
}

function IconBind() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 5H5a3 3 0 000 6h2M9 5h2a3 3 0 010 6H9M5 8h6" />
    </svg>
  );
}

function IconUnbind() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 5H5a3 3 0 000 6h2M9 5h2a3 3 0 010 6H9" />
      <line x1={6} y1={8} x2={10} y2={8} strokeDasharray="1.5 1.5" strokeOpacity={0.4} />
    </svg>
  );
}

function IconSelect() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x={2} y={2} width={12} height={12} rx={1} strokeDasharray="3 2" />
      <path d="M6 6h4v4H6z" fill="currentColor" stroke="none" opacity={0.4} />
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

function IconLayout() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx={8} cy={3} r={1.8} />
      <circle cx={3.5} cy={12} r={1.8} />
      <circle cx={12.5} cy={12} r={1.8} />
      <path d="M8 4.8v2.4M7 8l-2.5 2.4M9 8l2.5 2.4" />
    </svg>
  );
}

function IconExport() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 10V2M5 5l3-3 3 3" />
      <path d="M2.5 9.5v3a1 1 0 001 1h9a1 1 0 001-1v-3" />
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
