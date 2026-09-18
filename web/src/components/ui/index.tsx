import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "home"
  | "assignments"
  | "submissions"
  | "settings"
  | "plus"
  | "logout"
  | "search"
  | "code"
  | "chevronRight"
  | "chevronLeft"
  | "alert"
  | "clock"
  | "check"
  | "user";

const paths: Record<IconName, ReactNode> = {
  home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/></>,
  assignments: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
  submissions: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.13.37.35.7.64.96.29.26.66.4 1.06.4h.1v4h-.1c-.4 0-.77.14-1.06.4-.29.26-.51.59-.64.96Z"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  logout: <><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  code: <><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/></>,
  chevronRight: <path d="m9 18 6-6-6-6"/>,
  chevronLeft: <path d="m15 18-6-6 6-6"/>,
  alert: <><path d="M10.3 3.8 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return <svg aria-hidden="true" className={`icon ${props.className || ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>{paths[name]}</svg>;
}

export function Score({ n, max = 100 }: { n?: number; max?: number }) {
  return n === undefined ? <i className="status info">评估中</i> : <strong className={`score ${n >= 85 ? "good" : n >= 60 ? "mid" : "low"}`}>{n}<small> / {max}</small></strong>;
}

export function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return <div className="empty"><span>暂无内容</span><p>{text}</p>{action}</div>;
}

export function Title({ title, note, children }: { title: string; note: string; children?: ReactNode }) {
  return <div className="title"><span><h2>{title}</h2><p>{note}</p></span>{children}</div>;
}

export function Head({ name, action }: { name: string; action?: () => void }) {
  return <h3 className="head"><span>{name}</span>{action && <button onClick={action}>查看全部<Icon name="chevronRight" /></button>}</h3>;
}
