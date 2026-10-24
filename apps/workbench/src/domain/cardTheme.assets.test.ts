import { describe, expect, it } from "vitest";
import { allKeys } from "./cardTheme";

const bgModules = import.meta.glob("../../../../shared/assets/bg/*.webp");
const files = Object.keys(bgModules).map((path) => {
  const name = path.split("/").pop() ?? "";
  return name.replace(/\.webp$/, "");
});

describe("card theme assets", () => {
  it("matches shared bg webp files", () => {
    expect(files.length).toBe(42);
    expect(files.sort()).toEqual([...allKeys].sort());
  });
});
