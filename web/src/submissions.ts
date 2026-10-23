import type { Submission } from "./types";

// Select before applying filters so an older attempt never replaces the latest.
export function latestSubmissions(submissions: Submission[]): Submission[] {
  const latest = new Map<string, Submission>();
  for (const submission of submissions) {
    const key = JSON.stringify([submission.assignmentId, submission.studentId]);
    const previous = latest.get(key);
    if (!previous || compareSubmissionRecency(submission, previous) < 0) {
      latest.set(key, submission);
    }
  }
  return [...latest.values()].sort(compareSubmissionRecency);
}

function compareSubmissionRecency(left: Submission, right: Submission) {
  return (
    Date.parse(right.submittedAt) - Date.parse(left.submittedAt) ||
    right.id.localeCompare(left.id, "en", { numeric: true })
  );
}
