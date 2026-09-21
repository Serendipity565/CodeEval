import type { View } from "./types";

export type WorkspaceRoute = {
  view: View;
  assignmentId?: string;
  submissionId?: string;
};

export function readWorkspaceRoute(pathname: string): WorkspaceRoute {
  const parts = pathname.split("/").filter(Boolean);
  const id = parts[1];
  let decodedId: string | undefined;
  if (id) {
    try {
      decodedId = decodeURIComponent(id);
    } catch {
      return { view: "home" };
    }
  }
  if (parts[0] === "assignments" && parts[1]) {
    return parts[2] === "edit"
      ? { view: "edit", assignmentId: decodedId }
      : { view: "assignments", assignmentId: decodedId };
  }
  if (parts[0] === "submissions" && parts[1]) {
    return { view: "submissions", submissionId: decodedId };
  }
  if (parts[0] === "workspace") {
    const view = parts[1];
    if (
      view === "assignments" ||
      view === "submissions" ||
      view === "publish"
    ) {
      return { view };
    }
  }
  return { view: "home" };
}

export const viewPath = (view: View) =>
  `/workspace/${view === "edit" ? "assignments" : view}`;

export const assignmentPath = (id: string) =>
  `/assignments/${encodeURIComponent(id)}`;

export const editPath = (id: string) => `${assignmentPath(id)}/edit`;

export const submissionPath = (id: string) =>
  `/submissions/${encodeURIComponent(id)}`;
