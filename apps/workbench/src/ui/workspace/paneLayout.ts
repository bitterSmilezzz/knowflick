/** Keep requested sizes separate from the widths that currently fit the window. */
export type PaneWidths = { nav: number; list: number };
export const defaultPaneWidths: PaneWidths = { nav: 200, list: 320 };
export const paneLimits = { navMin: 160, navMax: 360, listMin: 240, listMax: 480, readerMin: 360 };
export const narrowWindowWidth = 980;

export function fitPaneWidths(requested: PaneWidths, viewport: number, navVisible: boolean): PaneWidths {
  const nav = Math.max(paneLimits.navMin, Math.min(paneLimits.navMax, requested.nav));
  const list = Math.max(paneLimits.listMin, Math.min(paneLimits.listMax, requested.list));
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
