import { apiRequest } from "./client";
import type { Assignment, Rubric, TestCase } from "../types";
export type CreateAssignmentInput = Pick<
  Assignment,
  | "title"
  | "language"
  | "description"
  | "status"
  | "maxSubmissions"
  | "dueAt"
  | "llmEvaluationEnabled"
> & {
  rubric: Rubric[];
  testCases?: TestCase[];
  referenceSolution?: string;
  knowledgeBase?: string;
};
export const listAssignments = (token: string) =>
  apiRequest<Assignment[]>("/assignments", token);
export const createAssignment = (token: string, input: CreateAssignmentInput) =>
  apiRequest<Assignment>("/assignments", token, {
    method: "POST",
    body: JSON.stringify(input),
  });
export const getAssignment = (token: string, id: string) =>
  apiRequest<Assignment>(`/assignments/${id}`, token);
export const updateAssignment = (
  token: string,
  id: string,
  input: CreateAssignmentInput,
) =>
  apiRequest<Assignment>(`/assignments/${id}`, token, {
    method: "PUT",
    body: JSON.stringify(input),
  });
export const updateAssignmentStatus = (
  token: string,
  id: string,
  status: Assignment["status"],
) =>
  apiRequest<{ id: string; status: Assignment["status"] }>(
    `/assignments/${id}/status`,
    token,
    { method: "PATCH", body: JSON.stringify({ status }) },
  );
export const updateAssignmentMaxSubmissions = (
  token: string,
  id: string,
  maxSubmissions: number,
) =>
  apiRequest<{ id: string; maxSubmissions: number }>(
    `/assignments/${id}/max-submissions`,
    token,
    { method: "PATCH", body: JSON.stringify({ maxSubmissions }) },
  );
