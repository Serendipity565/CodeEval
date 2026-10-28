const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
process.env.TZ = "Asia/Shanghai";
const calendar = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/calendar.ts"), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  { exports: calendar },
);
const {
  calendarDays,
  calendarDateKey,
  assignmentsByDate,
  calendarSubmissionState,
} = calendar;

test("month grids start on Sunday and include every day exactly once across year boundaries", () => {
  const days = calendarDays(new Date(2027, 0, 15));
  assert.equal(calendarDateKey(days[0]), "2026-12-27");
  assert.equal(calendarDateKey(days.at(-1)), "2027-02-06");
  assert.equal(days[0].getDay(), 0);
  assert.equal(days.at(-1).getDay(), 6);
  assert.equal(new Set(days.map(calendarDateKey)).size, days.length);
  assert.equal(days.filter((day) => day.getMonth() === 0).length, 31);
});

test("leap February and six-week months retain all dates", () => {
  assert.equal(
    calendarDays(new Date(2028, 1, 1)).filter((d) => d.getMonth() === 1).length,
    29,
  );
  assert.equal(calendarDays(new Date(2026, 4, 1)).length, 42);
  const sundayMonth = calendarDays(new Date(2026, 2, 1));
  assert.equal(calendarDateKey(sundayMonth[0]), "2026-03-01");
  assert.equal(sundayMonth.length, 35);
});

test("UTC deadlines group by the local date and sort by exact time without mutating data", () => {
  const items = Object.freeze([
    Object.freeze({ id: "late", dueAt: "2026-10-28T23:30:00+08:00" }),
    Object.freeze({ id: "invalid", dueAt: "" }),
    Object.freeze({ id: "next", dueAt: "2026-10-28T16:00:00Z" }),
    Object.freeze({ id: "early", dueAt: "2026-10-27T16:01:00Z" }),
  ]);
  const grouped = assignmentsByDate(items);
  assert.deepEqual(
    Array.from(grouped.get("2026-10-28"), (a) => a.id),
    ["early", "late"],
  );
  assert.equal(grouped.get("2026-10-29")[0].id, "next");
  assert.equal(grouped.size, 2);
  assert.equal(items[0].id, "late");
  assert.equal(assignmentsByDate([]).size, 0);
});

test("deadline equality becomes overdue, while submitted work stays submitted after closing", () => {
  const assignment = { status: "open", dueAt: "2026-10-28T12:00:00+08:00" };
  const deadline = Date.parse(assignment.dueAt);
  assert.equal(
    calendarSubmissionState(assignment, false, deadline - 1).tone,
    "pending",
  );
  assert.equal(
    calendarSubmissionState(assignment, false, deadline).tone,
    "overdue",
  );
  assert.equal(
    calendarSubmissionState(
      { ...assignment, status: "closed" },
      false,
      deadline - 1,
    ).tone,
    "closed",
  );
  assert.equal(
    calendarSubmissionState(
      { ...assignment, status: "closed" },
      true,
      deadline + 1,
    ).tone,
    "submitted",
  );
});
