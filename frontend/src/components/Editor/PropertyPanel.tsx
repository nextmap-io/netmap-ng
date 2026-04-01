import { useCallback } from "react";
import { useMapStore } from "@/hooks/useMapStore";
import { NodeProperties } from "./NodeProperties";
import { LinkProperties } from "./LinkProperties";

export function PropertyPanel() {
  const { map, editMode, selectedNodeId, selectedLinkId, clearSelection, updateNodeField, updateLinkField, deleteNode, deleteLink, saving, lastSaved } =
    useMapStore();



  const isOpen = editMode && (selectedNodeId !== null || selectedLinkId !== null);

  const selectedNode =
    selectedNodeId && map ? map.nodes.find((n) => n.id === selectedNodeId) ?? null : null;

  const selectedLink =
    selectedLinkId && map ? map.links.find((l) => l.id === selectedLinkId) ?? null : null;

  const handleNodeUpdate = useCallback(
    async (fields: Record<string, unknown>) => {
      if (!selectedNodeId) return;
      await updateNodeField(selectedNodeId, fields);
    },
    [selectedNodeId, updateNodeField],
  );

  const handleNodeDelete = useCallback(async () => {
    if (!selectedNodeId) return;
    clearSelection();
    await deleteNode(selectedNodeId);
  }, [selectedNodeId, clearSelection, deleteNode]);

  const handleLinkUpdate = useCallback(
    async (fields: Record<string, unknown>) => {
      if (!selectedLinkId) return;
      await updateLinkField(selectedLinkId, fields);
    },
    [selectedLinkId, updateLinkField],
  );

  const handleLinkDelete = useCallback(async () => {
    if (!selectedLinkId) return;
    clearSelection();
    await deleteLink(selectedLinkId);
  }, [selectedLinkId, clearSelection, deleteLink]);

  const savedAgo = lastSaved
    ? Math.max(0, Math.round((Date.now() - lastSaved) / 1000))
    : null;

  return (
    <div
      className={`fixed top-12 right-0 h-[calc(100vh-48px)] w-72 noc-glass border-l border-noc-border/50 z-30 flex flex-col transition-transform duration-200 ${
        isOpen ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-noc-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <svg
            viewBox="0 0 24 24"
            className="w-3.5 h-3.5 text-accent"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" />
          </svg>
          <span className="noc-label">
            {selectedNode
              ? "Node Properties"
              : selectedLink
                ? "Link Properties"
                : "Properties"}
          </span>
        </div>
        <button
          onClick={clearSelection}
          className="text-noc-text-dim hover:text-noc-text transition-colors"
          aria-label="Close properties"
        >
          <svg
            viewBox="0 0 24 24"
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {selectedNode && map && (
          <NodeProperties
            node={selectedNode}
            allNodes={map.nodes}
            onUpdate={handleNodeUpdate}
            onDelete={handleNodeDelete}
          />
        )}

        {selectedLink && !selectedNode && map && (
          <LinkProperties
            link={selectedLink}
            nodes={map.nodes}
            onUpdate={handleLinkUpdate}
            onDelete={handleLinkDelete}
          />
        )}
      </div>

      {/* Save indicator */}
      <div className="shrink-0 px-3 py-2 border-t border-noc-border/50">
        <div className="text-2xs text-noc-text-dim text-center">
          {saving && (
            <span className="flex items-center justify-center gap-1.5">
              <div className="w-2 h-2 border border-accent/40 border-t-accent rounded-full animate-spin-slow" />
              Saving...
            </span>
          )}
          {!saving && savedAgo !== null && (
            <span>Saved {savedAgo}s ago</span>
          )}
          {!saving && savedAgo === null && <span>&nbsp;</span>}
        </div>
      </div>
    </div>
  );
}
