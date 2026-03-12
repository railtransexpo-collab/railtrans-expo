import { useEffect, useState } from "react";

export default function useIsMobile(maxWidthPx = 900) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    const w = window.innerWidth || 0;
    return w > 0 ? w <= maxWidthPx : false;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mq =
      typeof window.matchMedia === "function"
        ? window.matchMedia(`(max-width: ${maxWidthPx}px)`)
        : null;

    const compute = () => {
      if (mq) return !!mq.matches;
      const w = window.innerWidth || 0;
      return w > 0 ? w <= maxWidthPx : false;
    };

    const sync = () => setIsMobile(compute());
    sync();

    // MediaQueryList listener (best when supported)
    if (mq) {
      if (typeof mq.addEventListener === "function") mq.addEventListener("change", sync);
      else if (typeof mq.addListener === "function") mq.addListener(sync);
    }

    // Fallbacks for webviews / weird resize behavior
    window.addEventListener("resize", sync, { passive: true });
    window.addEventListener("orientationchange", sync, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", sync, { passive: true });
    }

    return () => {
      if (mq) {
        if (typeof mq.removeEventListener === "function")
          mq.removeEventListener("change", sync);
        else if (typeof mq.removeListener === "function") mq.removeListener(sync);
      }
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", sync);
      }
    };
  }, [maxWidthPx]);

  return isMobile;
}

