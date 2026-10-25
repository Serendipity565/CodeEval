import type { Submission } from "./types";

export function visibleSubmissions(
  submissions: Submission[],
  teacher: boolean,
) {
  return teacher
    ? latestSubmissions(submissions)
    : [...submissions].sort(compareSubmissionRecency);
}

// Number attempts within each student's assignment before any list filters.
export function submissionAttempts(submissions: Submission[]) {
  const counts = new Map<string, number>();
  const attempts = new Map<string, number>();
  for (const submission of [...submissions]
    .sort(compareSubmissionRecency)
    .reverse()) {
    const key = JSON.stringify([submission.assignmentId, submission.studentId]);
    const attempt = (counts.get(key) ?? 0) + 1;
    counts.set(key, attempt);
    attempts.set(submission.id, attempt);
  }
  return attempts;
}

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
