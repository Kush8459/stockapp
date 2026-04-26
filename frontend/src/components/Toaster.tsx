import { createContext, useCallback, useContext, useMemo, useState } from "react";
import * as Toast from "@radix-ui/react-toast";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastKind = "success" | "error" | "info" | "alert";

export interface ToastItem {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
  durationMs?: number;
}

interface ToastContextValue {
  push: (t: Omit<ToastItem, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = crypto.randomUUID();
    setItems((prev) => [...prev, { id, ...t }]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const ctx = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={ctx}>
      <Toast.Provider swipeDirection="right" duration={6000}>
        {children}
        <AnimatePresence>
          {items.map((t) => (
            <ToastView key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </AnimatePresence>
        <Toast.Viewport className="fixed bottom-4 right-4 z-[100] flex w-96 max-w-[92vw] flex-col gap-2 outline-none" />
      </Toast.Provider>
    </ToastContext.Provider>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const tone = toneFor(item.kind);
  return (
    <Toast.Root
      duration={item.durationMs ?? 6000}
      onOpenChange={(open) => !open && onDismiss()}
      asChild
    >
      <motion.li
        initial={{ opacity: 0, x: 24, scale: 0.97 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        exit={{ opacity: 0, x: 24, transition: { duration: 0.18 } }}
        transition={{ type: "spring", stiffness: 280, damping: 26 }}
        className={cn(
          "card-elev relative flex gap-3 overflow-hidden border-l-2 p-4 pr-10",
          tone.border,
        )}
      >
        <div className={cn("mt-0.5", tone.text)}>{tone.icon}</div>
        <div className="flex-1">
          <Toast.Title className="text-sm font-medium text-fg">
            {item.title}
          </Toast.Title>
          {item.description && (
            <Toast.Description className="mt-0.5 text-xs text-fg-muted">
              {item.description}
            </Toast.Description>
          )}
        </div>
        <Toast.Close asChild>
          <button
            aria-label="Close"
            className="absolute right-2 top-2 rounded p-1 text-fg-muted hover:bg-white/5 hover:text-fg"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </Toast.Close>
      </motion.li>
    </Toast.Root>
  );
}

function toneFor(kind: ToastKind) {
  switch (kind) {
    case "success":
      return {
        border: "border-l-success",
        text: "text-success",
        icon: <CheckCircle2 className="h-4 w-4" />,
      };
    case "error":
      return {
        border: "border-l-danger",
        text: "text-danger",
        icon: <AlertTriangle className="h-4 w-4" />,
      };
    case "alert":
      return {
        border: "border-l-warn",
        text: "text-warn",
        icon: <AlertTriangle className="h-4 w-4" />,
      };
    case "info":
    default:
      return {
        border: "border-l-brand",
        text: "text-brand",
        icon: <Info className="h-4 w-4" />,
      };
  }
}
