import { apiRequest } from "./client";
import type {
  Assessment,
  AssignmentComparison,
  ExpertRating,
  Submission,
} from "../types";

type ScoresInput = {
  dimensions: { key: string; score: number }[];
  comment: string;
};
export const getAssessment = (token: string, id: string) =>
  apiRequest<Assessment>(
    `/submissions/${encodeURIComponent(id)}/assessment`,
    token,
  );
export const saveReview = (
  token: string,
  id: string,
  input: ScoresInput & { expectedReviewId: string },
) =>
  apiRequest<Submission>(
    `/submissions/${encodeURIComponent(id)}/reviews`,
    token,
    { method: "POST", body: JSON.stringify(input) },
  );
export const saveExpertRating = (
  token: string,
  id: string,
  input: ScoresInput & { expertName: string; durationSeconds: number },
) =>
  apiRequest<ExpertRating>(
    `/submissions/${encodeURIComponent(id)}/expert-ratings`,
    token,
    { method: "POST", body: JSON.stringify(input) },
  );
export const getComparison = (token: string, id: string) =>
  apiRequest<AssignmentComparison>(
    `/assignments/${encodeURIComponent(id)}/comparison`,
    token,
  );
