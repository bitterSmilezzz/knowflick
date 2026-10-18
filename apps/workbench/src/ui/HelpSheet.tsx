const SECTIONS: Array<[string, Array<[string, string]>]> = [
  ["桌面第一版 · 已可用", [
    ["⌘ K", "搜索卡库（支持拼音；结果可 ↥ 置顶到卡堆）"],
    ["← / →", "划走：略过 / 收藏"],
    ["↓", "跳过当前卡"],
    ["⌘ Z", "撤销上一张划卡"],
    ["回车 / 点按卡面", "打开当前卡详情"],
    ["Esc", "关闭搜索或帮助面板"],
  ]],
  ["侧栏", [
    ["刷卡", "摄影底图卡堆（与安卓同一套主题键）"],
    ["测验", "SM-2 / FSRS 队列与间隔预览"],
    ["剪藏 / 笔记 / AI 出卡", "入库后写入本地 cards.json"],
    ["导入 / 导出", "导入认 ZIP / JSON；导出的「另存为」选 .zip 得备份包（卡片 + 设置），选 .json 得裸 cards.json（与安卓同一份格式）；两者都不含 API 密钥"],
    ["详情链接", "在系统浏览器中打开（http/https）"],
  ]],
  ["第一版暂未接入", [
    ["—", "语音朗读、磨耳朵、知识星图、卡片追问"],
    ["—", "海报导出、局域网同步、桌面微件、学习地图"],
  ]],
];

export function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal help" onClick={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <h1>帮助与快捷键</h1>
          <button type="button" onClick={onClose}>关闭</button>
        </header>
        {SECTIONS.map(([title, rows]) => (
          <div key={title} className="help-section">
            <h2>{title}</h2>
            <table>
              <tbody>
                {rows.map(([keys, action]) => (
                  <tr key={keys}>
                    <th>{keys}</th>
                    <td>{action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>
    </div>
  );
}
