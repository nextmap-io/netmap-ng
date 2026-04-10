import { memo } from "react";
import { type NodeProps } from "@xyflow/react";

function LabelNodeComponent({ data, selected }: NodeProps) {
  const label = (data.label as string) || "Text";
  const style = data.style as Record<string, unknown> | undefined;
  const fontSize = String(style?.font_size || "12");
  const fontWeight = style?.bold ? "700" : "400";
  const fontStyle = style?.italic ? "italic" : "normal";
  const color = String(style?.color || "");
  const align = String(style?.align || "left");

  return (
    <div
      className={`px-1 py-0.5 select-none transition-all duration-150 ${
        selected ? "ring-1 ring-accent/50" : ""
      }`}
      style={{
        fontSize: `${fontSize}px`,
        fontWeight,
        fontStyle,
        color: color || undefined,
        textAlign: align as "left" | "center" | "right",
        whiteSpace: "pre-wrap",
        lineHeight: 1.3,
        minWidth: 20,
      }}
    >
      <span className={color ? "" : "text-noc-text-muted"}>{label}</span>
    </div>
  );
}

export const LabelNode = memo(LabelNodeComponent);
