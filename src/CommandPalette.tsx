import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CornerDownLeft, Search } from "lucide-react";

export type Command = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keywords?: string;
  icon: ReactNode;
  run: () => void;
};

/** ⌘K launcher: every page and common action is two keystrokes away. */
export default function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) => words.every((w) => `${c.label} ${c.keywords ?? ""} ${c.group}`.toLowerCase().includes(w)));
  }, [commands, query]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const choose = (c?: Command) => {
    if (!c) return;
    onClose();
    c.run();
  };
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      choose(results[index]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  let lastGroup = "";
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="命令面板" onKeyDown={onKey}>
        <div className="palette-input">
          <Search size={16} />
          <input autoFocus placeholder="搜索页面、操作或项目…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="搜索命令" role="combobox" aria-expanded="true" aria-controls="palette-list" />
          <span className="kbd">Esc</span>
        </div>
        <ul id="palette-list" ref={list} role="listbox">
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : "";
            lastGroup = c.group;
            return (
              <li key={c.id} role="presentation">
                {header && <div className="palette-group">{header}</div>}
                <button role="option" aria-selected={i === index} className={i === index ? "active" : ""} onMouseMove={() => setIndex(i)} onClick={() => choose(c)}>
                  <span className="palette-icon">{c.icon}</span>
                  <span className="palette-label">{c.label}</span>
                  {c.hint && <span className="kbd">{c.hint}</span>}
                </button>
              </li>
            );
          })}
          {!results.length && <li className="palette-empty">没有匹配「{query}」的命令</li>}
        </ul>
        <div className="palette-foot">
          <span>
            <span className="kbd">↑</span> <span className="kbd">↓</span> 选择
          </span>
          <span>
            <CornerDownLeft size={12} /> 执行
          </span>
        </div>
      </div>
    </div>
  );
}
