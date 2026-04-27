import { useCallback, useEffect, useRef } from "react";

/**
 * Returns a callback ref to attach to a sentinel element near the bottom
 * of a scrollable list. When the sentinel scrolls into view (with a
 * generous `rootMargin` so loads start before the user actually hits
 * the bottom), `onLoadMore` fires.
 *
 * Why a callback ref and not a regular `useRef` + `useEffect`:
 *   AnimatePresence with `mode="wait"` mounts the sentinel AFTER the
 *   exit animation of the previous container completes. With a normal
 *   ref, by the time `enabled` flips to true the DOM node hasn't been
 *   mounted yet, the effect attaches to `null`, and never re-runs
 *   because its deps haven't changed. A callback ref is invoked by React
 *   on every node mount/unmount — so the observer always wires up to
 *   whatever DOM node is currently in the tree.
 */
export function useInfiniteScroll(
  enabled: boolean,
  onLoadMore: () => void,
  rootMargin = "300px",
) {
  // Stable ref so changing `onLoadMore` between renders doesn't tear
  // down + re-attach the observer (which would lose intersection state).
  const cbRef = useRef(onLoadMore);
  cbRef.current = onLoadMore;

  // We track the current observer + node so that toggling `enabled`
  // (or rootMargin) without a node remount can still re-wire correctly.
  const observerRef = useRef<IntersectionObserver | null>(null);
  const nodeRef = useRef<HTMLDivElement | null>(null);

  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      // Tear down any existing observer first — required when the
      // sentinel unmounts (node === null) or remounts on a different
      // DOM element after AnimatePresence transitions.
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      nodeRef.current = node;
      if (!enabled || !node) return;
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting) cbRef.current();
        },
        { rootMargin },
      );
      obs.observe(node);
      observerRef.current = obs;
    },
    [enabled, rootMargin],
  );

  // If `enabled` flips while the same DOM node is still mounted (e.g.,
  // a fetch finishes and we want to start observing without the JSX
  // having to remount), re-attach by re-running with the current node.
  useEffect(() => {
    attach(nodeRef.current);
  }, [attach]);

  return attach;
}
