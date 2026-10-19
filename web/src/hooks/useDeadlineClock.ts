import { useEffect, useState } from "react";

// Wake at the next deadline even when the page stays open without new data.
export function useDeadlineClock(deadlines: number[]) {
  const [now, setNow] = useState(Date.now);
  const next = Math.min(...deadlines.filter((deadline) => deadline > now));
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = Number.isFinite(next)
      ? window.setTimeout(
          refresh,
          Math.max(0, Math.min(next - Date.now(), 2147483647)),
        )
      : undefined;
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [next, now]);
  return now;
}
