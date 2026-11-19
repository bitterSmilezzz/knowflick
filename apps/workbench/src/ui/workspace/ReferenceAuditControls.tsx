import { useEffect, useMemo, useState } from "react";
import type { ReferenceIssue } from "../../domain/referenceAudit";
import { addIgnored, issueKey, pruneIgnored, removeIgnored, splitIgnored } from "../../domain/referenceIgnore";
import { readIgnoredRefs, writeIgnoredRefs } from "./repository";
import { ReferenceAuditPanel } from "./ReferenceAuditPanel";

/** 由调用方以库目录作 key：切库时重新读取各自的本机偏好。 */
export function ReferenceAuditControls({ issues, scope, ready, onOpen, onRemove, onNotice }: {
  issues: readonly ReferenceIssue[];
  scope: string;
  /** 只有成功读完笔记快照，空清单才可以作为清理偏好的依据。 */
  ready: boolean;
  onOpen: (noteId: string) => void;
  onRemove: (issue: ReferenceIssue) => void;
  onNotice: (message: string) => void;
}) {
  const [ignoredRefs, setIgnoredRefs] = useState(() => readIgnoredRefs(scope));
  const split = useMemo(() => splitIgnored(issues, ignoredRefs), [issues, ignoredRefs]);

  useEffect(() => {
    if (!ready) return;
    const live = pruneIgnored(ignoredRefs, issues);
    if (live.length !== ignoredRefs.length) {
      setIgnoredRefs(live);
      return;
    }
    if (!writeIgnoredRefs(live, scope)) {
      onNotice("未能记住引用体检偏好，当前操作仅在本次打开期间生效。");
    }
  }, [issues, ignoredRefs, ready, scope, onNotice]);

  if (!ready) return null;
  return (
    <ReferenceAuditPanel
      issues={split.active}
      ignored={split.ignored}
      onOpen={onOpen}
      onRemove={onRemove}
      onIgnore={(issue) => {
        setIgnoredRefs((keys) => addIgnored(keys, issueKey(issue)));
        onNotice("已忽略这条问题，可在「已忽略」里撤销。");
      }}
      onUnignore={(issue) => {
        setIgnoredRefs((keys) => removeIgnored(keys, issueKey(issue)));
        onNotice("已撤销忽略，这条回到待复核清单。");
      }}
    />
  );
}
