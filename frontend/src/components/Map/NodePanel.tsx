import { useMemo } from "react";
import type { MapLink, MapNode, NodeStatusData, ScaleBand, TrafficData } from "@/types";
import { formatBps } from "./MapView";
import { NODE_TYPE_NAMES } from "./NetworkNode";
import { UtilBar } from "./UtilBar";
import { LINK_STATUS_WORD, nodeInfo, nodeName, peerOf } from "./linkInfo";

interface Props {
  node: MapNode;
  nodes: MapNode[];
  links: MapLink[];
  traffic: TrafficData;
  nodeStatus: NodeStatusData;
  scales: ScaleBand[];
  onOpenLink: (linkId: string) => void;
  onClose: () => void;
}

/**
 * Bottom panel for a node (view mode): every link of the node, busiest first,
 * with traffic seen from the node. A row opens that link's traffic graph.
 */
export function NodePanel({ node, nodes, links, traffic, nodeStatus, scales, onOpenLink, onClose }: Props) {
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const ni = nodeInfo(node, links, nodesById, traffic, scales, nodeStatus);
  const statusWord = ni.status === "down" ? "Down" : ni.status === "unknown" ? "Status unknown" : null;

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 max-h-[50vh] overflow-y-auto border-t border-border bg-card">
      <div className="px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-foreground">{nodeName(node)}</h2>
              {statusWord && (
                <span
                  className={`rounded px-1.5 text-xs leading-5 font-semibold ${
                    ni.status === "down" ? "bg-destructive text-on-destructive" : "border border-border text-muted-foreground"
                  }`}
                >
                  {statusWord}
                </span>
              )}
            </div>
            <p className="text-sm text-foreground-secondary">
              {[
                NODE_TYPE_NAMES[node.node_type] ?? "Node",
                `${ni.links.length} link${ni.links.length === 1 ? "" : "s"}`,
                ni.totalIn || ni.totalOut ? `${formatBps(ni.totalIn)} in · ${formatBps(ni.totalOut)} out` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              {node.info_url && (
                <>
                  {" · "}
                  <a href={node.info_url} target="_blank" rel="noreferrer" className="text-link hover:underline">
                    Open device page
                  </a>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close node details"
            title="Close"
            className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors duration-100 hover:bg-muted hover:text-foreground"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {ni.links.length === 0 ? (
          <p className="mt-3 text-sm text-foreground-secondary">This node has no links yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-1.5 pr-4 font-normal">Peer</th>
                  <th className="py-1.5 pr-4 font-normal">Link</th>
                  <th className="py-1.5 pr-4 text-right font-normal">In</th>
                  <th className="py-1.5 pr-4 font-normal">In %</th>
                  <th className="py-1.5 pr-4 text-right font-normal">Out</th>
                  <th className="py-1.5 pr-4 font-normal">Out %</th>
                  <th className="py-1.5 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {ni.links.map((li) => {
                  const { peer, iface } = peerOf(li, node.id);
                  // Seen from this node: when it is the link's target, the
                  // link's "out" (A→B) is what arrives here.
                  const isSource = li.link.source_id === node.id;
                  const inBps = isSource ? li.inBps : li.outBps;
                  const outBps = isSource ? li.outBps : li.inBps;
                  const inPct = isSource ? li.inPct : li.outPct;
                  const outPct = isSource ? li.outPct : li.inPct;
                  const worst = Math.max(inPct, outPct);
                  const word = li.status ? LINK_STATUS_WORD[li.status] : undefined;
                  return (
                    <tr
                      key={li.link.id}
                      onClick={() => onOpenLink(li.link.id)}
                      className="cursor-pointer border-b border-border-soft hover:bg-muted"
                      title="Open the traffic graph"
                    >
                      <td className="py-1.5 pr-4 text-foreground">{peer}</td>
                      <td className="py-1.5 pr-4 text-foreground-secondary">
                        {li.link.name}
                        {iface && <span className="font-ip text-muted-foreground"> · {iface}</span>}
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums text-foreground">{li.hasTraffic ? formatBps(inBps) : "—"}</td>
                      <td className="w-32 py-1.5 pr-4">
                        {li.hasTraffic && <UtilBar pct={inPct} severity={inPct === worst ? li.severity : "normal"} />}
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums text-foreground">{li.hasTraffic ? formatBps(outBps) : "—"}</td>
                      <td className="w-32 py-1.5 pr-4">
                        {li.hasTraffic && <UtilBar pct={outPct} severity={outPct === worst ? li.severity : "normal"} />}
                      </td>
                      <td className="py-1.5">
                        {word ? (
                          <span className={li.status === "down" ? "font-semibold text-destructive" : "text-muted-foreground"}>{word}</span>
                        ) : li.severity !== "normal" ? (
                          <span className={li.severity === "incident" ? "font-semibold text-destructive" : "text-warning"}>
                            {li.severity === "incident" ? "Incident" : "Watch"}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
