import { useLayoutEffect, useRef, useState } from "react";

export type MemberReadingPosition = { top: number; following: boolean; taskOpen?: boolean };
export type MemberReadingPositions = Map<string, MemberReadingPosition>;

/** Kept by the enclosing workbench, scoped to conversation + task instance. */
export function useMemberReadingPosition(
  key: string,
  positions: MemberReadingPositions,
  revision: unknown,
  initiallyFollowing: boolean,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const following = useRef(positions.get(key)?.following ?? initiallyFollowing);
  const [showLatest, setShowLatest] = useState(false);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const previous = positions.get(key);
    node.scrollTop = previous?.following
      ? node.scrollHeight
      : (previous?.top ?? (initiallyFollowing ? node.scrollHeight : 0));
    const update = () => {
      const away = node.scrollHeight - node.clientHeight - node.scrollTop > 80;
      following.current = !away;
      setShowLatest(away);
      positions.set(key, { ...positions.get(key), top: node.scrollTop, following: !away });
    };
    node.addEventListener("scroll", update, { passive: true });
    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (following.current) node.scrollTop = node.scrollHeight;
          });
    if (node.firstElementChild) resize?.observe(node.firstElementChild);
    return () => {
      positions.set(key, { ...positions.get(key), top: node.scrollTop, following: following.current });
      if (positions.size > 40) {
        const oldest = positions.keys().next().value;
        if (oldest !== undefined) positions.delete(oldest);
      }
      node.removeEventListener("scroll", update);
      resize?.disconnect();
    };
  }, [key, positions, initiallyFollowing]);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    if (following.current) node.scrollTop = node.scrollHeight;
    setShowLatest(node.scrollHeight - node.clientHeight - node.scrollTop > 80);
  }, [revision]);

  const scrollToLatest = () => {
    following.current = true;
    setShowLatest(false);
    const node = containerRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  };
  return { containerRef, showLatest, scrollToLatest };
}
