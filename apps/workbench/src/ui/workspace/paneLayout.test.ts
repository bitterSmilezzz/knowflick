import { describe, expect, it } from "vitest";
import { fitPaneWidths, loadPaneWidths } from "./paneLayout";

describe("workspace split layout", () => {
  it("preserves room for reading when both panes request their maximum width", () => {
    const fit = fitPaneWidths({ nav: 360, list: 480 }, 1040, true);
    expect(fit.nav + fit.list).toBeLessThanOrEqual(680);
    expect(fit.list).toBeGreaterThanOrEqual(240);
    expect(fitPaneWidths({ nav: 360, list: 480 }, 900, false)).toEqual({ nav: 360, list: 480 });
  });
  it("restores requested widths when a larger window can accommodate them", () => {
    expect(fitPaneWidths({ nav: 300, list: 420 }, 1440, true)).toEqual({ nav: 300, list: 420 });
  });
  it("recovers from invalid or unavailable stored preferences", () => {
    expect(loadPaneWidths({ getItem: () => "NaN" })).toEqual({ nav: 200, list: 320 });
    expect(loadPaneWidths({ getItem: () => { throw new Error("unavailable"); } })).toEqual({ nav: 200, list: 320 });
  });
});
