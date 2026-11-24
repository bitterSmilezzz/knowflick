/**
 * 笔记模板（B05）。
 *
 * 只解决「从空白开始写长文太难」这一件事：点一下模板，标题与骨架先摆好，
 * 用户接着写。**不自动建笔记**——空笔记堆积是路线图明确要避免的；
 * 模板只在用户点选那一刻起作用。
 *
 * 变量只在模板里替换（`{{date}}` 之类），正文里用户自己写的花括号不受影响。
 */

export type NoteTemplateId = "blank" | "journal" | "weekly" | "meeting" | "reading" | "project";

export interface NoteTemplate {
  id: NoteTemplateId;
  label: string;
  /** 标题模板；空模板给空串（保持「新建即空白」的老行为）。 */
  title: string;
  body: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 模板变量：日期、星期、周号。只支持这几个，够用且可预测。 */
export function templateVars(now: number): Record<string, string> {
  const d = new Date(now);
  const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  // 周号按「一年中第几周」算（周一为一周开始），与日历 App 口径一致。
  const start = new Date(d.getFullYear(), 0, 1);
  const days = Math.floor((d.getTime() - start.getTime()) / 86_400_000);
  const week = Math.ceil((days + start.getDay() + 1) / 7);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    weekday,
    week: `${d.getFullYear()}-W${pad(week)}`,
  };
}

export function renderTemplate(text: string, now = Date.now()): string {
  const vars = templateVars(now);
  return text.replace(/\{\{(date|weekday|week)\}\}/g, (_, name: string) => vars[name] ?? "");
}

export const NOTE_TEMPLATES: NoteTemplate[] = [
  { id: "blank", label: "空白笔记", title: "", body: "" },
  {
    id: "journal",
    label: "日记",
    title: "{{date}} 日记",
    body: [
      "## 今天做了什么",
      "",
      "## 值得记住的一件小事",
      "",
      "## 明天的第一件事",
      "- [ ] ",
      "",
    ].join("\n"),
  },
  {
    id: "weekly",
    label: "周记",
    title: "{{week}} 周记",
    body: [
      "## 本周进展",
      "",
      "## 证据与结果",
      "",
      "## 阻塞与风险",
      "",
      "## 下周优先",
      "- [ ] ",
      "",
    ].join("\n"),
  },
  {
    id: "meeting",
    label: "会议",
    title: "{{date}} 会议",
    body: [
      "## 参与人与背景",
      "",
      "## 议题与讨论",
      "",
      "## 决策",
      "",
      "## 行动项",
      "- [ ] （负责人，期限）",
      "",
      "## 待确认",
      "",
    ].join("\n"),
  },
  {
    id: "reading",
    label: "阅读",
    title: "《{{date}} 阅读》",
    body: [
      "## 作品与阅读目的",
      "",
      "## 核心观点",
      "",
      "## 原文摘录",
      "> ",
      "",
      "## 我的理解与疑问",
      "",
      "## 可应用的结论",
      "- [ ] ",
      "",
    ].join("\n"),
  },
  {
    id: "project",
    label: "项目",
    title: "{{date}} 项目笔记",
    body: [
      "## 目标与验收",
      "",
      "## 现状与证据",
      "",
      "## 下一步",
      "- [ ] ",
      "",
      "## 风险与依赖",
      "",
    ].join("\n"),
  },
];

export function findNoteTemplate(id: NoteTemplateId): NoteTemplate {
  return NOTE_TEMPLATES.find((t) => t.id === id) ?? NOTE_TEMPLATES[0];
}

/** 点模板得到的内容：标题与正文都渲染过变量。 */
export function instantiateTemplate(id: NoteTemplateId, now = Date.now()): { title: string; body: string } {
  const tpl = findNoteTemplate(id);
  return { title: renderTemplate(tpl.title, now), body: renderTemplate(tpl.body, now) };
}
