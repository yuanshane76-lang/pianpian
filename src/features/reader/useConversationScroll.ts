import { useCallback, useEffect, useLayoutEffect, useRef, type DependencyList } from "react";

const BOTTOM_THRESHOLD = 64;

export function useConversationScroll(updates: DependencyList) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previousTop = useRef(0);
  const frame = useRef<number | null>(null);

  const schedule = useCallback(() => {
    if (!following.current || frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const element = scrollRef.current;
      if (!element || !following.current) return;
      element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      previousTop.current = element.scrollTop;
    });
  }, []);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const gap = element.scrollHeight - element.clientHeight - element.scrollTop;
    if (gap <= 1) following.current = true;
    else if (element.scrollTop < previousTop.current) following.current = false;
    else if (gap <= BOTTOM_THRESHOLD) following.current = true;
    previousTop.current = element.scrollTop;
  }, []);

  const followLatest = useCallback(() => {
    following.current = true;
    schedule();
  }, [schedule]);

  useLayoutEffect(schedule, updates);

  useEffect(() => {
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    if (scrollRef.current) observer?.observe(scrollRef.current);
    if (contentRef.current) observer?.observe(contentRef.current);
    return () => {
      observer?.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [schedule]);

  return { scrollRef, contentRef, onScroll, followLatest };
}
