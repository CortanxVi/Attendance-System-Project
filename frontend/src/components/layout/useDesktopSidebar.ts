import { useEffect, useState } from 'react';

export function useDesktopSidebar(storageKey: string) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return window.localStorage.getItem(storageKey) === 'collapsed'; }
    catch { return false; }
  });
  const [hoverExpanded, setHoverExpanded] = useState(false);

  useEffect(() => {
    try { window.localStorage.setItem(storageKey, collapsed ? 'collapsed' : 'expanded'); }
    catch { /* Storage may be unavailable in private browsing. */ }
  }, [collapsed, storageKey]);

  const expandOnHover = () => {
    if (collapsed && window.matchMedia('(hover: hover) and (pointer: fine)').matches) setHoverExpanded(true);
  };

  return {
    collapsed,
    desktopExpanded: !collapsed || hoverExpanded,
    toggleCollapsed: () => setCollapsed((value) => !value),
    expandOnHover,
    stopHoverExpansion: () => setHoverExpanded(false),
  };
}
