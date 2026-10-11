import { useToastStore } from "../../stores/toast";

const accentColor: Record<string, string> = {
  info: "bg-accent",
  warning: "bg-warning",
  success: "bg-success",
};

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="flex items-stretch min-w-[240px] max-w-[360px] bg-bg-raised border border-border shadow-lg toast-enter rounded-lg overflow-hidden"
        >
          <div className={`w-1 shrink-0 ${accentColor[toast.type]}`} />
          <div className="flex items-center justify-between gap-2 px-3 py-2 flex-1">
            <span className="text-[12px] text-text">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              aria-label="Dismiss"
              className="text-text-dim hover:text-text transition-colors text-[12px] shrink-0"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
