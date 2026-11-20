import { useState } from "react";
import type { KnowledgeBaseSnapshot } from "./bindings/knowflick.local/workbench-go/internal/library/models";

type PickerProps = {
  snapshot: KnowledgeBaseSnapshot | null;
  error: string;
  scope: string;
  busy: boolean;
  dirty: boolean;
  writable: boolean;
  onScope: (id: string) => Promise<void>;
  onCreate: (name: string, description: string) => Promise<boolean>;
};

export function KnowledgeBasePicker({ snapshot, error, scope, busy, dirty, writable, onScope, onCreate }: PickerProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const bases = snapshot?.knowledgeBases ?? [];
  const active = bases.find((base) => base.id === scope);
  return (
    <details className="preview-knowledge-bases">
      <summary>{active ? "知识库 · " + active.name : "知识库"}</summary>
      {error && <p className="preview-error" role="alert">{error}</p>}
      {!snapshot && !error && <p role="status">正在读取知识库…</p>}
      {snapshot && <>
        <label>
          笔记范围
          <select value={scope} disabled={busy || dirty} onChange={(event) => void onScope(event.target.value)}>
            <option value="">全部笔记</option>
            {bases.map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}
          </select>
        </label>
        {dirty && <p className="preview-meta">保存当前改动后可以切换范围。</p>}
        {active?.description && <p className="preview-meta">{active.description}</p>}
        {writable && !creating && <button type="button" disabled={busy} onClick={() => setCreating(true)}>新建知识库</button>}
        {writable && creating && (
          <form onSubmit={async (event) => {
            event.preventDefault();
            if (await onCreate(name, description)) {
              setCreating(false);
              setName("");
              setDescription("");
            }
          }}>
            <label>名称<input required value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
            <label>描述<input value={description} disabled={busy} onChange={(event) => setDescription(event.target.value)} /></label>
            <div className="preview-actions">
              <button type="submit" disabled={busy || !name.trim()}>创建</button>
              <button type="button" disabled={busy} onClick={() => setCreating(false)}>取消</button>
            </div>
          </form>
        )}
      </>}
    </details>
  );
}

export function NoteKnowledgeBases({ snapshot, noteID, busy, writable, onChange }: {
  snapshot: KnowledgeBaseSnapshot;
  noteID: string;
  busy: boolean;
  writable: boolean;
  onChange: (id: string, member: boolean) => Promise<void>;
}) {
  const bases = snapshot.knowledgeBases ?? [];
  return (
    <details className="preview-knowledge-bases">
      <summary>所属知识库</summary>
      {bases.length === 0 ? <p className="preview-meta">还没有知识库。</p> : (
        <ul>
          {bases.map((base) => {
            const member = snapshot.membership?.[base.id + "\n" + noteID] !== undefined;
            return (
              <li key={base.id}>
                {writable ? <label>
                  <input type="checkbox" checked={member} disabled={busy} onChange={(event) => void onChange(base.id, event.target.checked)} />
                  {base.name}
                </label> : <span>{base.name}{member ? " · 已加入" : " · 未加入"}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
