import { useEffect, useRef, useState } from 'react';

const REFRESH_THRESHOLD = 64;
const MAX_PULL_DISTANCE = 88;
const IGNORE_TARGETS = 'input, textarea, select, video, [contenteditable="true"], [data-disable-pull-refresh]';

export function usePullToRefresh<T extends HTMLElement>() {
  const containerRef = useRef<T>(null);
  const startYRef = useRef<number | null>(null);
  const trackingRef = useRef(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onTouchStart = (event: TouchEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.touches.length !== 1 || container.scrollTop > 0 || target?.closest(IGNORE_TARGETS)) {
        trackingRef.current = false;
        startYRef.current = null;
        return;
      }
      startYRef.current = event.touches[0].clientY;
      trackingRef.current = true;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!trackingRef.current || startYRef.current === null || event.touches.length !== 1) return;
      const delta = event.touches[0].clientY - startYRef.current;
      if (delta <= 0 || container.scrollTop > 0) {
        setPullDistance(0);
        return;
      }
      event.preventDefault();
      setPullDistance(Math.min(MAX_PULL_DISTANCE, delta * 0.46));
    };
    const finish = () => {
      if (!trackingRef.current) return;
      trackingRef.current = false;
      startYRef.current = null;
      setPullDistance((distance) => {
        if (distance >= REFRESH_THRESHOLD) {
          setRefreshing(true);
          window.setTimeout(() => window.location.reload(), 120);
          return REFRESH_THRESHOLD;
        }
        return 0;
      });
    };
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', finish, { passive: true });
    container.addEventListener('touchcancel', finish, { passive: true });
    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', finish);
      container.removeEventListener('touchcancel', finish);
    };
  }, []);
  return { containerRef, pullDistance, refreshing, threshold: REFRESH_THRESHOLD };
}
