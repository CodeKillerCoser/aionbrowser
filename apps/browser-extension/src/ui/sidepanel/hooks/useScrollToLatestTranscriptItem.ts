import { useEffect } from "react";
import type { RefObject } from "react";

export function useScrollToLatestTranscriptItem(
  viewportRef: RefObject<HTMLDivElement | null>,
  dependency: unknown,
) {
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollTop = viewport.scrollHeight;
  }, [dependency, viewportRef]);
}
