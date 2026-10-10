import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";

type Kind = "success" | "error" | "info";
type Item = { id: number; kind: Kind; text: string; action?: { label: string; run: () => void } };
type Push = (kind: Kind, text: string, action?: Item["action"]) => void;

const Ctx = createContext<Push>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((list) => list.filter((i) => i.id !== id)), []);
  const push = useCallback<Push>(
    (kind, text, action) => {
      const id = ++seq.current;
      // Same message twice in a row replaces rather than stacks.
      setItems((list) => [...list.filter((i) => i.text !== text).slice(-3), { id, kind, text, action }]);
      window.setTimeout(() => dismiss(id), kind === "error" ? 9000 : action ? 8000 : 4200);
    },
    [dismiss],
  );
  const value = useMemo(() => push, [push]);
  const Icon = { success: CircleCheck, error: CircleAlert, info: Info };
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((t) => {
          const I = Icon[t.kind];
          return (
            <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
              <I size={17} />
              <p>{t.text}</p>
              {t.action && (
                <button
                  className="toast-action"
                  onClick={() => {
                    t.action!.run();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
              <button aria-label="关闭提示" onClick={() => dismiss(t.id)}>
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
