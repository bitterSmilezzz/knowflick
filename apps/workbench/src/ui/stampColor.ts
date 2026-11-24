export function stampColor(category: string): string {
  if (/会计|财务|理财|投资|经济/.test(category)) return "#C79A4B";
  if (/AI|Agent|编程|算法|Rust|Python|科技|数据|网络|安全|架构/i.test(category)) return "#4A9ED9";
  if (/物理|生物|天文|数学|化学|地理|基因|生态|海洋|地质|气象/.test(category)) return "#5B8BC4";
  return "#B07E9C";
}
