import { findTool } from "../lib/catalog";

/** Colored monogram tile. Consistent across themes, no brand assets needed. */
export default function ToolMark({ id, size = 28 }: { id: string; size?: number }) {
  const tool = findTool(id);
  const color = tool?.color ?? "#8b95a5";
  return (
    <span
      className="tool-mark"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        color,
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
      }}
    >
      {tool?.glyph ?? id.slice(0, 2).toUpperCase()}
    </span>
  );
}
