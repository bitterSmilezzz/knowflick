import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { defaultPaneWidths, fitPaneWidths, loadPaneWidths, narrowWindowWidth, paneLimits, type PaneWidths } from "./paneLayout";

export function usePaneLayout() {
  const [requested, setRequested] = useState<PaneWidths>(() => loadPaneWidths(localStorage));
  const [viewport, setViewport] = useState(window.innerWidth);
  const [navOverride, setNavOverride] = useState<boolean | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const navVisible = viewport > narrowWindowWidth && navOverride !== false;
  const navOverlay = viewport <= narrowWindowWidth && navOverride === true;
  const widths = fitPaneWidths(requested, viewport, navVisible);
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    const breakpoint = window.matchMedia(`(max-width: ${narrowWindowWidth}px)`);
    breakpoint.addEventListener("change", resize);
    const observer = new ResizeObserver(resize);
    observer.observe(document.getElementById("root") ?? document.documentElement);
    return () => {
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      breakpoint.removeEventListener("change", resize);
      observer.disconnect();
      dragCleanup.current?.();
    };
  }, []);

  const saveWidth = (pane: keyof PaneWidths, value: number) => {
    try { localStorage.setItem(`knowflick.split.${pane}-w`, String(value)); } catch { /* Session layout still works when storage is unavailable. */ }
  };
  const setWidth = (pane: keyof PaneWidths, value: number, persist = true) => {
    const low = pane === "nav" ? paneLimits.navMin : paneLimits.listMin;
    const high = pane === "nav" ? paneLimits.navMax : paneLimits.listMax;
    const bounded = Math.max(low, Math.min(high, value));
    setRequested(prev => ({ ...prev, [pane]: bounded }));
    if (persist) saveWidth(pane, bounded);
  };
  const startResize = (pane: keyof PaneWidths, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragCleanup.current?.();
    const target = event.currentTarget;
    const pointer = event.pointerId;
    const startX = event.clientX;
    const startWidth = widths[pane];
    const ceiling = pane === "nav"
      ? Math.min(paneLimits.navMax, viewport - paneLimits.readerMin - widths.list)
      : Math.min(paneLimits.listMax, viewport - paneLimits.readerMin - (navVisible ? widths.nav : 0));
    const floor = pane === "nav" ? paneLimits.navMin : paneLimits.listMin;
    let latest = startWidth;
    target.setPointerCapture(pointer);
    const move = (e: PointerEvent) => {
      latest = Math.round(Math.max(floor, Math.min(ceiling, startWidth + e.clientX - startX)));
      setWidth(pane, latest, false);
    };
    const finish = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", finish);
      target.removeEventListener("pointercancel", finish);
      target.removeEventListener("lostpointercapture", finish);
      if (target.hasPointerCapture(pointer)) target.releasePointerCapture(pointer);
      saveWidth(pane, latest);
      dragCleanup.current = null;
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", finish);
    target.addEventListener("lostpointercapture", finish);
    dragCleanup.current = finish;
  };
  return {
    widths,
    navMode: navVisible ? "expanded" : navOverlay ? "overlay" : "collapsed",
    navShown: navVisible || navOverlay,
    toggleNav: () => setNavOverride(prev => !(prev ?? viewport > narrowWindowWidth)),
    closeNavOverlay: () => { if (viewport <= narrowWindowWidth) setNavOverride(false); },
    startResize,
    resetWidth: (pane: keyof PaneWidths) => setWidth(pane, defaultPaneWidths[pane]),
    nudgeWidth: (pane: keyof PaneWidths, delta: number) => setWidth(pane, widths[pane] + delta),
  };
}
