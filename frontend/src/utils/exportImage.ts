import { getNodesBounds, getViewportForBounds, type Node } from "@xyflow/react";

/**
 * Export the current ReactFlow map as a PNG using the documented recipe:
 * compute the bounding box of all nodes, derive a viewport transform that fits
 * those bounds at full map size, then rasterise only the `.react-flow__viewport`
 * element (which excludes the minimap, controls and background — they live
 * outside the viewport node) via html-to-image's `toPng`.
 *
 * html-to-image is imported lazily so it lands in its own chunk.
 */
export async function exportMapToPng(
  nodes: Node[],
  mapName: string,
  backgroundColor: string,
): Promise<void> {
  if (nodes.length === 0) return;

  const viewportEl = document.querySelector<HTMLElement>(".react-flow__viewport");
  if (!viewportEl) return;

  const bounds = getNodesBounds(nodes);
  const padding = 0.12;
  const imageWidth = Math.max(Math.ceil(bounds.width * (1 + padding * 2)), 800);
  const imageHeight = Math.max(Math.ceil(bounds.height * (1 + padding * 2)), 600);
  const transform = getViewportForBounds(bounds, imageWidth, imageHeight, 0.1, 2, padding);

  const { toPng } = await import("html-to-image");
  const dataUrl = await toPng(viewportEl, {
    backgroundColor,
    width: imageWidth,
    height: imageHeight,
    pixelRatio: 2,
    style: {
      width: `${imageWidth}px`,
      height: `${imageHeight}px`,
      transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
    },
  });

  const safeName = (mapName || "map").trim().replace(/[^\w.-]+/g, "_") || "map";
  const link = document.createElement("a");
  link.download = `${safeName}.png`;
  link.href = dataUrl;
  link.click();
}
