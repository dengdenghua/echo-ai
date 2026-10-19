import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

/**
 * Let short live output occupy only its real content height, then cap long
 * output at the waterfall-window height. While the window is outside the
 * viewport (the reader is browsing history), freeze the last measured outer
 * height so new tokens cannot move historical content under the reader.
 */
export function useViewportAwareLiveWindowHeight(
  ref: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  trigger: string,
  maxHeight = 128,
): number | undefined {
  const isVisibleRef = useRef(true);
  const [height, setHeight] = useState<number>();

  const measure = useCallback(() => {
    const content = contentRef.current;
    if (!content || !isVisibleRef.current) return;
    // Measure an unconstrained inner node, not the scroll viewport itself.
    // Once the viewport has reached its cap, its own scrollHeight can never
    // fall below clientHeight. Reading it made a later shorter update inherit
    // the old 128px height and leave a visible empty block below the text.
    const naturalHeight = Math.ceil(content.scrollHeight);
    if (naturalHeight < 1) return;
    const nextHeight = Math.min(maxHeight, Math.max(0, naturalHeight));
    setHeight((current) => (current === nextHeight ? current : nextHeight));
  }, [contentRef, maxHeight]);

  useLayoutEffect(() => {
    measure();
  }, [measure, trigger]);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      isVisibleRef.current = entry?.isIntersecting ?? true;
      if (isVisibleRef.current) measure();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure, ref]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [contentRef, measure]);

  return height;
}
