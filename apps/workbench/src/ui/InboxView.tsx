import { useState, useEffect } from "react";
import { dbListMaterials, dbUpdateMaterialStatus, type RawMaterial } from "../shell/store";

interface Props {
  dir: string;
  onTransformMaterial?: (material: RawMaterial) => void;
  onOpenCard?: (cardId: string) => void;
}

export function InboxView({ dir, onTransformMaterial }: Props) {
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      setLoading(true);
      const list = await dbListMaterials(true, dir);
      setMaterials(list);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [dir]);

  const handleDismiss = async (id: string) => {
    try {
      await dbUpdateMaterialStatus(id, "dismissed", dir);
      setMaterials((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="detail">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>收件箱（待整理素材）</h1>
        <button type="button" onClick={() => void refresh()}>刷新</button>
      </div>

      <p className="hint">
        收集箱存放你随时记录的闪念、网页剪藏正文和导入文档。点击「提炼成卡片」可将其结构化入库。
      </p>

      {error ? <p className="banner error">{error}</p> : null}

      {loading ? (
        <p>正在读取收件箱...</p>
      ) : materials.length === 0 ? (
        <div className="empty" style={{ padding: "40px 0" }}>
          <h2>收件箱空空如也</h2>
          <p>按下快捷键呼出闪念胶囊，随时记下灵感或贴入网页链接。</p>
        </div>
      ) : (
        <ul className="library-list">
          {materials.map((mat) => (
            <li key={mat.id} className="library-item">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "4px" }}>
                  <span className="badge" style={{ fontSize: "11px" }}>
                    {mat.sourceType === "web" ? "网页" : mat.sourceType === "manual" ? "闪念" : "文档"}
                  </span>
                  <strong>{mat.title}</strong>
                </div>
                <p style={{ margin: "4px 0", fontSize: "13px", color: "var(--muted)" }}>
                  {mat.rawText.substring(0, 160)}...
                </p>
                <div style={{ fontSize: "11px", color: "var(--muted)", display: "flex", gap: "12px" }}>
                  <span>{new Date(mat.createdAt).toLocaleString()}</span>
                  {mat.sourceUrl ? <span>来源: {mat.sourceUrl}</span> : null}
                </div>
              </div>

              <div className="actions" style={{ marginLeft: "16px", display: "flex", gap: "6px" }}>
                {onTransformMaterial ? (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => onTransformMaterial(mat)}
                  >
                    提炼卡片
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleDismiss(mat.id)}
                >
                  归档
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
