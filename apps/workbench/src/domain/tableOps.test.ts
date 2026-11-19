import { describe, expect, it } from "vitest";
import { deleteTableColumn, deleteTableRow, findTableAt, insertTableColumn, insertTableRow } from "./tableOps";

const TABLE = ["前文", "", "| 甲 | 乙 | 丙 |", "| --- | --- | --- |", "| 1 | 2 | 3 |", "| 4 | 5 | 6 |", "", "后文"].join("\n");

/** 把光标放到「第 line 行、第 column 个单元格开头」。 */
function caret(line: number, column = 0): { text: string; start: number; end: number } {
  const lines = TABLE.split("\n");
  let offset = 0;
  for (let i = 0; i < line; i += 1) offset += lines[i].length + 1;
  const target = lines[line];
  let seen = 0;
  let pos = 0;
  for (let i = 0; i < target.length; i += 1) {
    if (target[i] === "|") {
      if (seen === column) { pos = i + 1; break; }
      seen += 1;
    }
  }
  const at = offset + Math.min(pos, target.length);
  return { text: TABLE, start: at, end: at };
}

describe("表格行列增删（B01）", () => {
  it("认出光标所在的表格块：行范围、列数、当前行列", () => {
    const table = findTableAt(TABLE, caret(4, 1).start);
    expect(table).not.toBeNull();
    expect(table!.startLine).toBe(2);
    expect(table!.endLine).toBe(5);
    expect(table!.columns).toBe(3);
    expect(table!.cursorLine).toBe(4);
    expect(table!.cursorColumn).toBe(1);
  });

  it("不在表格里返回 null——正文里用竖线排版的几行不算表格", () => {
    expect(findTableAt("甲 | 乙\n丙 | 丁", 0)).toBeNull();
    // 有竖线但没有分隔行：不是表格
    expect(findTableAt("| 甲 | 乙 |\n| 1 | 2 |", 2)).toBeNull();
  });

  it("在下面插一行：列数与表头一致", () => {
    const out = insertTableRow(caret(4, 0), "below");
    const lines = out.text.split("\n");
    expect(lines[5]).toBe("|  |  |  |");
    expect(lines.length).toBe(TABLE.split("\n").length + 1);
  });

  it("在表头插行会插到分隔行下面，否则表格就不成立了", () => {
    const out = insertTableRow(caret(2, 0), "above");
    const lines = out.text.split("\n");
    // 第 2 行仍是表头、第 3 行仍是分隔行，新行落到第 4 行。
    expect(lines[2]).toBe("| 甲 | 乙 | 丙 |");
    expect(lines[3]).toBe("| --- | --- | --- |");
    expect(lines[4]).toBe("|  |  |  |");
  });

  it("删数据行：表头与分隔行不删", () => {
    const out = deleteTableRow(caret(4, 0));
    expect(out.text).not.toContain("| 1 | 2 | 3 |");
    expect(out.text).toContain("| 4 | 5 | 6 |");
    // 光标在表头或分隔行时什么都不做
    expect(deleteTableRow(caret(2, 0)).text).toBe(TABLE);
    expect(deleteTableRow(caret(3, 0)).text).toBe(TABLE);
  });

  it("插一列：每行都跟着加，分隔行补 ---", () => {
    const out = insertTableColumn(caret(4, 1), "right");
    const lines = out.text.split("\n");
    // 空格子统一渲染成空串，与插行时保持一致。
    expect(lines[2]).toBe("| 甲 | 乙 |  | 丙 |");
    expect(lines[3]).toBe("| --- | --- | --- | --- |");
    expect(lines[4]).toBe("| 1 | 2 |  | 3 |");
  });

  it("删一列：每行都跟着少一个", () => {
    const out = deleteTableColumn(caret(4, 1));
    const lines = out.text.split("\n");
    expect(lines[2]).toBe("| 甲 | 丙 |");
    expect(lines[4]).toBe("| 1 | 3 |");
  });

  it("只剩一列时不再删：Markdown 表格至少要一列", () => {
    const one = ["| 甲 |", "| --- |", "| 1 |"].join("\n");
    const at = { text: one, start: 0, end: 0 };
    expect(deleteTableColumn(at).text).toBe(one);
  });

  it("某行少一列时按表头补齐，避免每次操作都多一行错位格子", () => {
    const ragged = ["| 甲 | 乙 |", "| --- | --- |", "| 1 |"].join("\n");
    const at = { text: ragged, start: 0, end: 0 };
    const out = insertTableColumn(at, "right");
    const lines = out.text.split("\n");
    // 三列：表头、分隔行、数据行都必须有三个格子。
    expect(lines[0].split("|").length).toBe(5);
    expect(lines[1].split("|").length).toBe(5);
    expect(lines[2].split("|").length).toBe(5);
  });
});
