import { useEffect, useRef, useState } from "react";

/** Two breaths of the highlight glow, matching the CSS animation (1.9 s × 2). */
export const ARRIVAL_MS = 3800;

/**
 * True for a moment after `ready` turns from false to true: the part has just arrived and gets
 * the breathing highlight. Content that is ready from the first render (a reopened result, a
 * cached analysis) does not animate.
 */
export function useArrival(ready: boolean, durationMs = ARRIVAL_MS): boolean {
  const [arrived, setArrived] = useState(false);
  const wasReady = useRef(ready);
  useEffect(() => {
    if (ready && !wasReady.current) {
      wasReady.current = true;
      setArrived(true);
      const timer = setTimeout(() => setArrived(false), durationMs);
      return () => clearTimeout(timer);
    }
    if (!ready) wasReady.current = false;
    return undefined;
  }, [ready, durationMs]);
  return arrived;
}
