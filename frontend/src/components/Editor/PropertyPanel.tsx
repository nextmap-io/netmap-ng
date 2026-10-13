import { useCallback, useEffect, useState } from "react";
import { useMapStore } from "@/hooks/useMapStore";
import { NodeProperties } from "./NodeProperties";
import { LinkProperties } from "./LinkProperties";
import { BulkNodeProperties, BulkLinkProperties } from "./BulkProperties";

export function PropertyPanel() {
  const { map, editMode, selectedNodeId, selectedLinkId, selectedNodeIds, selectedLinkIds, clearSelection, updateNodeField, updateLinkField, bulkUpdateNodes, bulkUpdateLinks, deleteNode, deleteLink, saving, lastSaved } =
    useMapStore();

  const multiNodes = selectedNodeIds.length >= 2;
  const multiLinks = selectedLinkIds.length >= 2;

  const isOpen =
    editMode && (selectedNodeId !== null || selectedLinkId !== null || multiNodes || multiLinks);

  const selectedNode =
    selectedNodeId && map ? map.nodes.find((n) => n.id === selectedNodeId) ?? null : null;

  const selectedLink =
    selectedLinkId && map ? map.links.find((l) => l.id === selectedLinkId) ?? null : null;

  const handleBulkNodes = useCallback(
    (fields: Record<string, unknown>) => bulkUpdateNodes(selectedNodeIds, fields),
    [bulkUpdateNodes, selectedNodeIds],
  );
  const handleBulkLinks = useCallback(
    (fields: Record<string, unknown>) => bulkUpdateLinks(selectedLinkIds, fields),
    [bulkUpdateLinks, selectedLinkIds],
  );

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

  // Tick once a second so the "Saved Xs ago" label stays current instead of
  // freezing at the value captured on the render that set lastSaved.
  const [now, setNow] = useState(() => Date.now());
  // savedAgo clamps at 0, so a `now` older than lastSaved just reads "0s"
  // until the first tick.
  useEffect(() => {
    if (!lastSaved) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lastSaved]);

  const savedAgo = lastSaved ? Math.max(0, Math.round((now - lastSaved) / 1000)) : null;

  return (
    <div
      className={`fixed top-12 right-0 h-[calc(100vh-48px)] w-72 max-w-full bg-card border-l border-border z-30 flex flex-col transition-transform duration-150 ${
        isOpen ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <h2 className="text-lg font-semibold text-foreground">
          {multiNodes
            ? `${selectedNodeIds.length} nodes selected`
            : multiLinks
              ? `${selectedLinkIds.length} links selected`
              : selectedNode
                ? "Node"
                : selectedLink
                  ? "Link"
                  : "Properties"}
        </h2>
        <button
          onClick={clearSelection}
          className="w-7 h-7 inline-flex items-center justify-center rounded text-foreground-secondary hover:bg-muted hover:text-foreground transition-colors"
          aria-label="Close properties"
          title="Close"
        >
          <svg
            viewBox="0 0 24 24"
            className="w-4 h-4"
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
        {multiNodes && (
          <BulkNodeProperties count={selectedNodeIds.length} onApply={handleBulkNodes} />
        )}

        {multiLinks && !multiNodes && (
          <BulkLinkProperties count={selectedLinkIds.length} onApply={handleBulkLinks} />
        )}

        {!multiNodes && !multiLinks && selectedNode && map && (
          <NodeProperties
            node={selectedNode}
            allNodes={map.nodes}
            onUpdate={handleNodeUpdate}
            onDelete={handleNodeDelete}
          />
        )}

        {!multiNodes && !multiLinks && selectedLink && !selectedNode && map && (
          <LinkProperties
            link={selectedLink}
            nodes={map.nodes}
            onUpdate={handleLinkUpdate}
            onDelete={handleLinkDelete}
          />
        )}
      </div>

      {/* Save indicator */}
      <div className="shrink-0 px-3 py-2 border-t border-border">
        <div className="text-sm text-muted-foreground" aria-live="polite">
          {saving && <span>Saving…</span>}
          {!saving && savedAgo !== null && (
            <span>Saved {savedAgo}s ago</span>
          )}
          {!saving && savedAgo === null && <span>&nbsp;</span>}
        </div>
      </div>
    </div>
  );
}
