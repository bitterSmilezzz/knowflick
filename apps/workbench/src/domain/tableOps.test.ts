import { describe, expect, it } from "vitest";
import { deleteTableColumn, deleteTableRow, findTableAt, insertTableColumn, insertTableRow, setTableCell, tableCellAt } from "./tableOps";

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

describe("改单元格文字（B01）", () => {
  it("只改那一个格子，同行其它格子不动", () => {
    const out = setTableCell(caret(4, 1), "已发布");
    const lines = out.text.split("\n");
    expect(lines[4]).toBe("| 1 | 已发布 | 3 |");
    expect(lines[2]).toBe("| 甲 | 乙 | 丙 |");
  });

  it("表头可以改：列名写错了要能修", () => {
    const out = setTableCell(caret(2, 0), "项目名");
    expect(out.text.split("\n")[2]).toBe("| 项目名 | 乙 | 丙 |");
  });

  it("分隔行不能改：那一行的横线是表格的骨架", () => {
    const at = caret(3, 0);
    expect(setTableCell(at, "乱写").text).toBe(at.text);
    expect(tableCellAt(at)).toBeNull();
  });

  it("内容里的竖线会被转义，否则整行错位", () => {
    const out = setTableCell(caret(4, 0), "甲|乙");
    const line = out.text.split("\n")[4];
    // 仍然是三列：竖线被转义成 \|，没有变成新的列分隔符。
    expect(line).toBe("| 甲\\|乙 | 2 | 3 |");
    expect(cellsOfLine(line).length).toBe(3);
  });

  it("换行被压成空格：单元格里不能有换行", () => {
    const out = setTableCell(caret(4, 0), "第一行\n第二行");
    expect(out.text.split("\n")[4]).toBe("| 第一行 第二行 | 2 | 3 |");
  });

  it("读出当前格子的文字，并说明是不是表头", () => {
    expect(tableCellAt(caret(4, 1))).toEqual({ value: "2", header: false });
    expect(tableCellAt(caret(2, 0))).toEqual({ value: "甲", header: true });
    // 不在表格里
    expect(tableCellAt({ text: "普通段落", start: 0, end: 0 })).toBeNull();
  });
});

/** 按行拆单元格，用来验证转义之后列数没变。 */
function cellsOfLine(line: string): string[] {
  // 先把转义的竖线换成占位符，再按竖线拆——与实现同一个思路。
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").replace(/\\\|/g, "\u0000").split("|").map((c) => c.replace(/\u0000/g, "|").trim());
}
