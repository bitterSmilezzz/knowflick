import { useEffect, useState, type CSSProperties } from "react";

const paths: Record<string, string> = {
  inbox: "M4 5h16v14H4z M4 12h4l2 3h4l2-3h4",
  mail: "M3 5h18v14H3z M3 6l9 7 9-7",
  library: "M4 5h6v14H4z M14 5h6v14h-6z M7 9v6 M17 9v6",
  star: "m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z",
  archive: "M3 5h18v4H3z M5 9v10h14V9 M10 13h4",
  folder: "M3 6h6l2 2h10v11H3z",
  settings: "M4 6h16 M4 12h16 M4 18h16 M9 3v6 M16 9v6 M8 15v6",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13 M16 16l5 5",
  plus: "M12 5v14 M5 12h14",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  filter: "M4 6h16 M7 12h10 M10 18h4",
  panel: "M3 4h18v16H3z M10 4v16",
  edit: "m4 16 12-12 4 4L8 20H4z M13 7l4 4",
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
  ask: "M4 4h16v13H9l-5 4z M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4 M12 15v.1",
  external: "M14 3h7v7 M21 3l-11 11 M10 4H4v16h16v-6",
  check: "m5 12 4 4 10-10",
  video: "M3 5h18v14H3z m7 4 5 3-5 3z",
  code: "m8 7-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16",
  note: "M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5",
  image: "M3 3h18v18H3z m0 13 6-6 5 5 3-3 4 4",
  card: "M3 4h18v16H3z M7 9h10 M7 13h10 M7 17h5",
  upload: "M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  brief: "M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h4",
  close: "m6 6 12 12 M18 6 6 18",
  download: "M12 3v13 M7 11l5 5 5-5 M4 18v3h16v-3",
  layers: "m12 3 9 4.5-9 4.5-9-4.5z M3 12l9 4.5 9-4.5 M3 16.5 12 21l9-4.5",
  mic: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z M5 11a7 7 0 0 0 14 0 M12 18v3",
};

export type IconName = keyof typeof paths;

export function Icon({
  name,
  size = 16,
  className,
  style,
}: {
  name: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.65}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      <path d={paths[name] ?? paths.note} />
    </svg>
  );
}

const META: Record<string, { label: string; icon: string }> = {
  manual: { label: "随手灵感", icon: "edit" },
  email: { label: "邮件", icon: "mail" },
  "email-digest": { label: "邮件归纳", icon: "brief" },
  web: { label: "网页剪藏", icon: "note" },
  document: { label: "文档", icon: "library" },
  audio: { label: "语音", icon: "note" },
  image: { label: "图片", icon: "image" },
  card: { label: "知识卡", icon: "card" },
};

export function sourceLabel(source: string, url: string): { label: string; icon: string } {
  if (source === "email" || source === "email-digest") return META[source];
  if (url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (host.includes("github.com")) return { label: "GitHub", icon: "code" };
      if (host.includes("bilibili.com") || host.includes("b23.tv")) return { label: "B站", icon: "video" };
      if (host.includes("xiaohongshu.com")) return { label: "小红书", icon: "image" };
      if (host.includes("mp.weixin.qq.com")) return { label: "公众号", icon: "note" };
      if (host === "x.com" || host.includes("twitter.com")) return { label: "X", icon: "note" };
      return { label: host, icon: "note" };
    } catch {
      return { label: "链接", icon: "note" };
    }
  }
  return META[source] ?? { label: source || "内容", icon: "note" };
}

/** Follows the OS appearance in real time instead of waiting for a reload. */
export function useSystemAppearance(): "light" | "dark" {
  const [appearance, setAppearance] = useState<"light" | "dark">(() =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
  );

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const onChange = (event: MediaQueryListEvent) =>
      setAppearance(event.matches ? "dark" : "light");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return appearance;
}
