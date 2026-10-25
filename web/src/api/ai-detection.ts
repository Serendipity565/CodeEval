import { apiRequest } from "./client";
import type { AIDetection } from "../types";

export const detectAICode = (
  token: string,
  assignmentId: string,
  submissionId: string,
  signal?: AbortSignal,
) =>
  apiRequest<AIDetection>(
    `/assignments/${encodeURIComponent(assignmentId)}/ai-detection`,
    token,
    { method: "POST", body: JSON.stringify({ submissionId }), signal },
  );
