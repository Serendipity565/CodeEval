import type { ReactNode, SVGProps } from "react";
import type { Submission } from "../../types";
import "./ui.css";

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
  | "user"
  | "calendar"
  | "arrowUpRight"
  | "arrowRight"
  | "activity"
  | "arrowDown"
  | "refresh"
  | "eye"
  | "eyeOff";

const paths: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="m3 10 9-7 9 7" />
      <path d="M5 9v11h14V9" />
      <path d="M9 20v-6h6v6" />
    </>
  ),
  assignments: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  submissions: (
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.13.37.35.7.64.96.29.26.66.4 1.06.4h.1v4h-.1c-.4 0-.77.14-1.06.4-.29.26-.51.59-.64.96Z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  logout: (
    <>
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
      <path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  code: (
    <>
      <path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14" />
    </>
  ),
  chevronRight: <path d="m9 18 6-6-6-6" />,
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  alert: (
    <>
      <path d="M10.3 3.8 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2M8 18h2" />
    </>
  ),
  arrowUpRight: (
    <>
      <path d="M6 18 18 6M6 6h12v12" />
    </>
  ),
  arrowRight: (
    <>
      <path d="M4 12h16m-6-6 6 6-6 6" />
    </>
  ),
  activity: (
    <>
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </>
  ),
  arrowDown: (
    <>
      <path d="M12 4v16m-6-6 6 6 6-6" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6.1 6.1A8 8 0 0 1 19.6 9M4.4 15a8 8 0 0 0 13.5 2.9" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="m3 3 18 18M10.6 5.1 12 5c6.5 0 10 7 10 7a19 19 0 0 1-3 4.1M6.3 6.3A20.2 20.2 0 0 0 2 12s3.5 7 10 7a11.8 11.8 0 0 0 5.7-1.7M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
};

export function Icon({
  name,
  className,
  ...props
}: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      className={`icon ${className || ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

export function Score({ n, max = 100 }: { n?: number; max?: number }) {
  return n === undefined ? (
    <i className="status info">评估中</i>
  ) : (
    <strong className={`score ${n >= 85 ? "good" : n >= 60 ? "mid" : "low"}`}>
      {n}
      <small> / {max}</small>
    </strong>
  );
}

export function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="empty ui-empty">
      <div className="ui-empty-mark" aria-hidden="true">
        <Icon name="assignments" />
      </div>
      <span>暂无内容</span>
      <p>{text}</p>
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  );
}

export function Title({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children?: ReactNode;
}) {
  return (
    <div className="title">
      <span>
        <h2>{title}</h2>
        <p>{note}</p>
      </span>
      {children}
    </div>
  );
}

export function Head({ name, action }: { name: string; action?: () => void }) {
  return (
    <h3 className="head">
      <span>{name}</span>
      {action && (
        <button type="button" onClick={action}>
          查看全部
          <Icon name="chevronRight" />
        </button>
      )}
    </h3>
  );
}

const submissionStates: Record<
  Submission["status"],
  { label: string; icon: IconName }
> = {
  queued: { label: "排队中", icon: "clock" },
  evaluating: { label: "评估中", icon: "refresh" },
  graded: { label: "已评分", icon: "check" },
  needs_review: { label: "待复核", icon: "eye" },
  failed: { label: "评估失败", icon: "alert" },
};

export function SubmissionStatus({ status }: { status: Submission["status"] }) {
  const state = submissionStates[status];
  return (
    <span className={`submission-state submission-state--${status}`}>
      <Icon name={state.icon} />
      <span>{state.label}</span>
    </span>
  );
}

export function WorkspaceSkeleton({
  variant = "dashboard",
}: {
  variant?: "dashboard" | "list";
}) {
  return (
    <div
      className={`workspace-skeleton workspace-skeleton--${variant}`}
      role="status"
      aria-label="正在加载工作台"
    >
      <div className="workspace-skeleton-content" aria-hidden="true">
        <div className="workspace-skeleton-heading">
          <div>
            <span className="skeleton-block skeleton-heading" />
            <span className="skeleton-block skeleton-description" />
          </div>
          <span className="skeleton-block skeleton-action" />
        </div>
        {variant === "dashboard" && (
          <div className="workspace-skeleton-metrics">
            {[0, 1, 2, 3].map((item) => (
              <div className="workspace-skeleton-metric" key={item}>
                <span className="skeleton-block skeleton-label" />
                <span className="skeleton-block skeleton-number" />
                <span className="skeleton-block skeleton-caption" />
              </div>
            ))}
          </div>
        )}
        <div className="workspace-skeleton-panel">
          <div className="workspace-skeleton-toolbar">
            <span className="skeleton-block skeleton-label" />
            <span className="skeleton-block skeleton-caption" />
          </div>
          {[0, 1, 2, 3, 4].map((item) => (
            <div className="workspace-skeleton-row" key={item}>
              <span className="skeleton-block skeleton-row-icon" />
              <div>
                <span className="skeleton-block skeleton-row-title" />
                <span className="skeleton-block skeleton-row-note" />
              </div>
              <span className="skeleton-block skeleton-row-value" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
