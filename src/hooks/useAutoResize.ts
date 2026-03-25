import { useCallback } from "react";

/**
 * Auto-resize a textarea to fit its content, up to maxRows.
 * Returns an onChange handler that should be spread onto the textarea.
 * Usage: <textarea onChange={autoResize} ... />
 */
export function useAutoResize(minRows = 2, maxRows = 10) {
  const autoResize = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const ta = e.target;
      // Reset to min height to measure scrollHeight accurately
      ta.style.height = "auto";
      const lineHeight = parseInt(getComputedStyle(ta).lineHeight) || 18;
      const minHeight = lineHeight * minRows;
      const maxHeight = lineHeight * maxRows;
      const newHeight = Math.min(Math.max(ta.scrollHeight, minHeight), maxHeight);
      ta.style.height = `${newHeight}px`;
    },
    [minRows, maxRows],
  );

  return autoResize;
}
