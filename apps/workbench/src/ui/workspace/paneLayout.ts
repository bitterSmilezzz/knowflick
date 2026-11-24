/** Keep requested sizes separate from the widths that currently fit the window. */
export type PaneWidths = { nav: number; list: number };
export const defaultPaneWidths: PaneWidths = { nav: 200, list: 320 };
export const paneLimits = { navMin: 160, navMax: 360, listMin: 240, listMax: 480, readerMin: 360 };
export const narrowWindowWidth = 980;

export const compactWindowWidth = paneLimits.listMin + paneLimits.readerMin;

export type PaneVisibility = { nav: boolean; list: boolean };
const visibilityKeys: Record<keyof PaneVisibility, string> = {
  nav: "knowflick.split.nav-visible",
  list: "knowflick.split.list-visible",
};

export function loadPaneVisibility(storage: Pick<Storage, "getItem">): PaneVisibility {
  const read = (pane: keyof PaneVisibility) => {
    try {
      const raw = storage.getItem(visibilityKeys[pane]);
      return raw !== "0";
    } catch {
      return true;
    }
  };
  return { nav: read("nav"), list: read("list") };
}

export function savePaneVisibility(storage: Pick<Storage, "setItem">, pane: keyof PaneVisibility, visible: boolean): void {
  try {
    storage.setItem(visibilityKeys[pane], visible ? "1" : "0");
  } catch { /* Storage unavailable: the session still honours the toggle. */ }
}

export function fitPaneWidths(requested: PaneWidths, viewport: number, navVisible: boolean, listVisible = true): PaneWidths {
  const nav = Math.max(paneLimits.navMin, Math.min(paneLimits.navMax, requested.nav));
  const list = Math.max(paneLimits.listMin, Math.min(paneLimits.listMax, requested.list));
  if (!listVisible) return { nav, list };
  const budget = Math.max(paneLimits.listMin, viewport - paneLimits.readerMin);
  if (!navVisible) return { nav, list: Math.min(list, budget) };
  const fittedNav = Math.min(nav, Math.max(paneLimits.navMin, budget - paneLimits.listMin));
  return { nav: fittedNav, list: Math.min(list, Math.max(paneLimits.listMin, budget - fittedNav)) };
}

export function loadPaneWidths(storage: Pick<Storage, "getItem">): PaneWidths {
  const read = (key: string, fallback: number) => {
    try {
      const raw = storage.getItem(key);
      const value = raw === null ? fallback : Number(raw);
      return Number.isFinite(value) ? value : fallback;
    } catch { return fallback; }
  };
  return {
    nav: Math.max(paneLimits.navMin, Math.min(paneLimits.navMax, read("knowflick.split.nav-w", 200))),
    list: Math.max(paneLimits.listMin, Math.min(paneLimits.listMax, read("knowflick.split.list-w", 320))),
  };
}
