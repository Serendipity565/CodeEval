import { apiRequest } from "./client";
import type { SimilarityReport } from "../types";

export const checkSimilarity = (
  token: string,
  assignmentId: string,
  submissionIds: string[],
  template: string,
) =>
  apiRequest<SimilarityReport>(
    `/assignments/${encodeURIComponent(assignmentId)}/similarity`,
    token,
    { method: "POST", body: JSON.stringify({ submissionIds, template }) },
  );
