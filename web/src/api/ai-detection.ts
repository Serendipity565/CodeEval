import { apiRequest, ApiError } from "./client";
import type { AIDetection, AISampleLibrary } from "../types";

export type AIDetectionOptions = {
  provider: "deepseek" | "droiddetect";
  available: boolean;
  requiresSamples: boolean;
  description: string;
};

export const getAIDetectionOptions = (
  token: string,
  assignmentId: string,
  signal?: AbortSignal,
) => apiRequest<AIDetectionOptions>(
  `/assignments/${encodeURIComponent(assignmentId)}/ai-detection/options`,
  token,
  { signal },
);

export const getAISampleLibrary = (
  token: string,
  assignmentId: string,
  signal?: AbortSignal,
) =>
  apiRequest<AISampleLibrary>(
    `/assignments/${encodeURIComponent(assignmentId)}/ai-samples`,
    token,
    { signal },
  );

export const generateAISampleLibrary = (
  token: string,
  assignmentId: string,
  signal?: AbortSignal,
) =>
  apiRequest<AISampleLibrary>(
    `/assignments/${encodeURIComponent(assignmentId)}/ai-samples`,
    token,
    { method: "POST", signal },
  );

// Finish the shared sample bank before any submission in a run is analysed.
export async function prepareAISampleLibrary(
  token: string,
  assignmentId: string,
  signal?: AbortSignal,
) {
  const library = await generateAISampleLibrary(token, assignmentId, signal);
  if (
    library.status !== "ready" ||
    library.expectedCount !== 3 ||
    library.bank?.samples.length !== 3
  )
    throw new ApiError(
      "同题 AI 样本尚未全部就绪，本批识别未开始，请先完成样本生成后重试",
      503,
    );
  return library;
}

export const detectAICode = (
  token: string,
  assignmentId: string,
  submissionId: string,
  signal?: AbortSignal,
  regenerate = false,
) =>
  apiRequest<AIDetection>(
    `/assignments/${encodeURIComponent(assignmentId)}/ai-detection`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ submissionId, regenerate }),
      signal,
    },
  );

export const getSavedAIDetections = (
  token: string,
  assignmentId: string,
  submissionId?: string,
  signal?: AbortSignal,
) =>
  apiRequest<{ results: AIDetection[] }>(
    `/assignments/${encodeURIComponent(assignmentId)}/ai-detection${submissionId ? `?submissionId=${encodeURIComponent(submissionId)}` : ""}`,
    token,
    { signal },
  );
