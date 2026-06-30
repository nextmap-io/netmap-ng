import type { ElkNode, LayoutOptions } from "elkjs/lib/elk-api";
import type { MapNode, MapLink } from "@/types";

export type LayoutAlgorithm = "force" | "layered";

const ALGO_ID: Record<LayoutAlgorithm, string> = {
  force: "org.eclipse.elk.force",
  layered: "org.eclipse.elk.layered",
};

function nodeSize(n: MapNode): { w: number; h: number } {
  if (n.node_type === "group") return { w: n.width || 400, h: n.height || 300 };
  return { w: n.width || 90, h: n.height || 36 };
}

/**
 * Compute new node positions using elkjs. The library is imported lazily so it
 * is only pulled into a separate chunk when auto-layout is actually invoked.
 *
 * Groups are mapped to ELK compound nodes with their children nested; ELK's
 * child coordinates are relative to the parent, which matches how ReactFlow /
 * the store stores child node positions (relative to parent_id).
 *
 * Returns a flat list of { id, x, y } for every laid-out node (including
 * children). The caller decides which of these to apply.
 */
export async function computeAutoLayout(
  nodes: MapNode[],
  links: MapLink[],
  algorithm: LayoutAlgorithm,
): Promise<Array<{ id: string; x: number; y: number }>> {
  if (nodes.length === 0) return [];

  const ELK = (await import("elkjs/lib/elk.bundled.js")).default;
  const elk = new ELK();

  const ids = new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Group children under their parent group when both are part of the set.
  const childrenByParent = new Map<string | null, MapNode[]>();
  for (const n of nodes) {
    const parent = n.parent_id && ids.has(n.parent_id) ? n.parent_id : null;
    const arr = childrenByParent.get(parent) ?? [];
    arr.push(n);
    childrenByParent.set(parent, arr);
  }

  const compoundOptions: LayoutOptions = {
    "elk.algorithm": ALGO_ID[algorithm],
    "elk.spacing.nodeNode": "50",
    "elk.padding": "[top=44,left=24,bottom=24,right=24]",
  };

  const toElk = (n: MapNode): ElkNode => {
    const { w, h } = nodeSize(n);
    const kids = childrenByParent.get(n.id);
    const node: ElkNode = { id: n.id, width: w, height: h };
    if (kids && kids.length > 0) {
      node.children = kids.map(toElk);
      node.layoutOptions = compoundOptions;
    }
    return node;
  };

  const rootChildren = (childrenByParent.get(null) ?? []).map(toElk);

  const elkEdges = links
    .filter((l) => ids.has(l.source_id) && ids.has(l.target_id))
    .map((l) => ({ id: l.id, sources: [l.source_id], targets: [l.target_id] }));

  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": ALGO_ID[algorithm],
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.spacing.nodeNode": "60",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
      "elk.padding": "[top=40,left=40,bottom=40,right=40]",
    },
    children: rootChildren,
    edges: elkEdges,
  };

  const res = await elk.layout(graph);

  const out: Array<{ id: string; x: number; y: number }> = [];
  const walk = (n: ElkNode) => {
    if (n.id !== "root" && byId.has(n.id)) {
      out.push({ id: n.id, x: Math.round(n.x ?? 0), y: Math.round(n.y ?? 0) });
    }
    n.children?.forEach(walk);
  };
  walk(res);
  return out;
}
