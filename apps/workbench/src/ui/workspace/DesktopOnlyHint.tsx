import { openExternalUrl } from "../../shell/store";
import { inShell } from "../../shell/store";

/**
 * 浏览器体验模式下「去桌面端」的入口。
 *
 * 背景：浏览器体验里有一堆能力用不了——录音落盘、导出 cards.json、
 * 全局快捷键、托盘胶囊、ASR、语义模型。界面各处都写着「桌面客户端可用」，
 * 但**没有任何一处告诉用户怎么去**——被告知要去，却没地方去。
 *
 * 这不是文案问题，是**断链**：用户被卡住时看到的下一句话是「请在桌面客户端
 * 使用语音笔记」，而他连桌面客户端在哪都不知道。
 *
 * 仓库是公开的，Releases 里有一键下载，所以给一条**可点的路**。
 */
export const DESKTOP_DOWNLOAD_URL = "https://github.com/bitterSmilezzz/knowflick/releases/latest";

export function DesktopOnlyHint({ text, children }: { text?: string; children?: React.ReactNode }) {
  // 桌面端本来就能用，不需要告诉用户去哪。
  if (inShell()) return null;
  return (
    <div className="ws-desktop-only" data-hint="desktop-only">
      {text ? <p className="ws-hint">{text}</p> : null}
      <button
        type="button"
        className="ws-bordered"
        onClick={() => void openExternalUrl(DESKTOP_DOWNLOAD_URL)}
      >
        下载桌面客户端
      </button>
      {children}
    </div>
  );
}
