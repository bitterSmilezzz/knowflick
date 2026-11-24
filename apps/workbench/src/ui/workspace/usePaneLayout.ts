import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { compactWindowWidth, defaultPaneWidths, fitPaneWidths, loadPaneVisibility, loadPaneWidths, narrowWindowWidth, paneLimits, savePaneVisibility, type PaneVisibility, type PaneWidths } from "./paneLayout";

export function usePaneLayout(hasExplicitSelection: boolean) {
  const [requested, setRequested] = useState<PaneWidths>(() => loadPaneWidths(localStorage));
  const [visibility, setVisibility] = useState<PaneVisibility>(() => loadPaneVisibility(localStorage));
  const [viewport, setViewport] = useState(window.innerWidth);
  const [navOverlay, setNavOverlay] = useState(false);
  const [compactList, setCompactList] = useState<boolean | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const narrow = viewport <= narrowWindowWidth;
  const compact = viewport < compactWindowWidth;
  const navVisible = !narrow && visibility.nav;
  const showNavOverlay = narrow && navOverlay;
  const listShown = compact ? (compactList ?? !hasExplicitSelection) : visibility.list;
  const widths = fitPaneWidths(requested, viewport, navVisible, listShown);

  useEffect(() => {
    const resize = () => {
      const width = window.innerWidth;
      setViewport(width);
      if (width > narrowWindowWidth) setNavOverlay(false);
      if (width >= compactWindowWidth) setCompactList(null);
    };
    window.addEventListener("resize", resize);
    // 页面从后台切回时补一次：后台期间浏览器可能只改尺寸、不发 resize，回到前台要自己纠正。
    document.addEventListener("visibilitychange", resize);
    window.visualViewport?.addEventListener("resize", resize);
    const breakpoint = window.matchMedia(`(max-width: ${narrowWindowWidth}px)`);
    breakpoint.addEventListener("change", resize);
    const observer = new ResizeObserver(resize);
    observer.observe(document.getElementById("root") ?? document.documentElement);
    return () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", resize);
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
      ? Math.min(paneLimits.navMax, viewport - paneLimits.readerMin - (listShown ? widths.list : 0))
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
  const setVisible = (pane: keyof PaneVisibility, visible: boolean) => {
    setVisibility(prev => ({ ...prev, [pane]: visible }));
    savePaneVisibility(localStorage, pane, visible);
  };
  const showCompactReader = useCallback(() => {
    if (compact) setCompactList(false);
  }, [compact]);
  return {
    widths,
    navMode: navVisible ? "expanded" : showNavOverlay ? "overlay" : "collapsed",
    navShown: navVisible || showNavOverlay,
    compact,
    listShown,
    toggleNav: () => {
      // 窄窗口：只开合浮层，不写入持久选择——否则一次临时打开会把「收起」永久关掉。
      if (narrow) { setNavOverlay(open => !open); return; }
      const next = !visibility.nav;
      setVisible("nav", next);
      // 宽窗口里**明确展开**过侧栏：随后把窗口缩窄时它该以浮层出现，
      // 而不是无声消失（旧行为如此，桌面交互冒烟钉着这一条）。
      setNavOverlay(next);
    },
    toggleList: () => {
      if (compact) setCompactList(!listShown);
      else setVisible("list", !listShown);
    },
    showList: () => {
      if (compact) setCompactList(true);
      else if (!listShown) setVisible("list", true);
    },
    showCompactReader,
    resetCompactList: () => setCompactList(null),
    closeNavOverlay: () => setNavOverlay(false),
    startResize,
    resetWidth: (pane: keyof PaneWidths) => setWidth(pane, defaultPaneWidths[pane]),
    nudgeWidth: (pane: keyof PaneWidths, delta: number) => setWidth(pane, widths[pane] + delta),
  };
}
