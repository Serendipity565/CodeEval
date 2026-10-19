import type { Submission } from "../../types";
import { finalMaxScore, finalScore } from "../../assessment";
import { Score } from "../ui";

export default function SubmissionScore({
  submission,
}: {
  submission: Submission;
}) {
  const score = finalScore(submission);
  return score === undefined ? (
    <span className="score-placeholder">
      {submission.evaluation ? "待评分" : "—"}
    </span>
  ) : (
    <Score n={score} max={finalMaxScore(submission)} />
  );
}
