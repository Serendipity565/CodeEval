const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../src/submissions.ts"), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const exportsObject = {};
vm.runInNewContext(compiled, { exports: exportsObject });
const { latestSubmissions, visibleSubmissions, submissionAttempts } =
  exportsObject;

function submission(id, values = {}) {
  return {
    id,
    assignmentId: "1",
    studentId: "2",
    studentName: "学生",
    submittedAt: "2026-10-23T00:00:00Z",
    status: "graded",
    ...values,
  };
}
const ids = (items) => Array.from(items, (item) => item.id);

test("selects latest by time regardless of input order, timezone or ID order", () => {
  const older = submission("20", { submittedAt: "2026-10-23T08:30:00+08:00" });
  const newer = submission("3", { submittedAt: "2026-10-23T01:00:00Z" });
  assert.deepEqual(ids(latestSubmissions([older, newer])), ["3"]);
  assert.deepEqual(ids(latestSubmissions([newer, older])), ["3"]);
});

test("keeps each student in each assignment independently, including namesakes", () => {
  const items = [
    submission("1"),
    submission("2", { assignmentId: "3" }),
    submission("3", { studentId: "4" }),
    submission("4"),
  ];
  assert.deepEqual(ids(latestSubmissions(items)), ["4", "3", "2"]);
});

test("breaks equal-time ties by numeric ID, including IDs beyond JS safe integers", () => {
  assert.deepEqual(
    ids(latestSubmissions([submission("9"), submission("10")])),
    ["10"],
  );
  assert.deepEqual(
    ids(
      latestSubmissions([
        submission("9007199254740992"),
        submission("9007199254740993"),
      ]),
    ),
    ["9007199254740993"],
  );
});

test("score and review filters never bring back an earlier attempt", () => {
  const older = submission("1", { score: 40, review: { total: 40 } });
  const newer = submission("2", { score: 90 });
  const latest = latestSubmissions([older, newer]);
  assert.equal(latest.filter((item) => item.score < 60).length, 0);
  assert.equal(latest.filter((item) => item.review).length, 0);
  const pending = submission("3", { status: "evaluating" });
  assert.deepEqual(ids(latestSubmissions([older, newer, pending])), ["3"]);
});

test("preserves original history for attempt limits and direct detail access", () => {
  const history = Object.freeze([
    Object.freeze(submission("1")),
    Object.freeze(submission("2")),
  ]);
  assert.deepEqual(ids(latestSubmissions(history)), ["2"]);
  assert.deepEqual(ids(history), ["1", "2"]);
  assert.deepEqual(ids(latestSubmissions([])), []);
});

test("students see all attempts, including failures and pending grades, while teachers see latest only", () => {
  const history = Object.freeze([
    Object.freeze(submission("1", { status: "failed" })),
    Object.freeze(submission("2", { status: "graded" })),
    Object.freeze(submission("3", { status: "evaluating" })),
  ]);
  assert.deepEqual(ids(visibleSubmissions(history, false)), ["3", "2", "1"]);
  assert.deepEqual(ids(visibleSubmissions(history, true)), ["3"]);
  assert.deepEqual(ids(history), ["1", "2", "3"]);
  // Filtering student history can still find the earlier failed attempt.
  assert.deepEqual(
    ids(
      visibleSubmissions(history, false).filter((s) => s.status === "failed"),
    ),
    ["1"],
  );
});

test("attempt numbers follow chronology within each student and assignment, independently of filters", () => {
  const history = [
    submission("10"),
    submission("2", { assignmentId: "3" }),
    submission("3", { studentId: "4" }),
    submission("9"),
    submission("8", { submittedAt: "2026-10-22T00:00:00Z" }),
  ];
  const attempts = submissionAttempts(history);
  assert.equal(attempts.get("8"), 1);
  assert.equal(attempts.get("9"), 2);
  assert.equal(attempts.get("10"), 3);
  assert.equal(attempts.get("2"), 1);
  assert.equal(attempts.get("3"), 1);
  assert.equal(submissionAttempts([]).size, 0);
});

test("assignment history URLs preserve the assignment filter on reload", () => {
  const navigationExports = {};
  const navigationCode = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/navigation.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText;
  vm.runInNewContext(navigationCode, { exports: navigationExports });
  const url = navigationExports.assignmentHistoryPath("作业 1");
  const route = navigationExports.readWorkspaceRoute(url);
  assert.equal(route.view, "submissions");
  assert.equal(route.assignmentId, "作业 1");
  assert.equal(
    navigationExports.readWorkspaceRoute("/assignments/1").view,
    "assignments",
  );
  assert.equal(
    navigationExports.readWorkspaceRoute("/submissions/9").submissionId,
    "9",
  );
});
