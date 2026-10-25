const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const compiled = ts.transpileModule(
  fs.readFileSync(
    path.join(__dirname, "../src/components/similarity/ai-report.ts"),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
function load(globals = {}) {
  const exports = {};
  vm.runInNewContext(compiled, { exports, ...globals });
  return exports;
}
const api = load();
function row(id = "1", rate = 72.5) {
  return {
    source: {
      id,
      assignmentId: "2",
      studentId: id,
      studentName: `测试学生 ${id}`,
      submittedAt: "2026-10-25T00:00:00Z",
      code: 'value = 1\nprint("<script>alert(1)</script>")',
      status: "graded",
    },
    state: "done",
    result: {
      submissionId: id,
      status: rate === null ? "insufficient_evidence" : "estimated",
      aiRate: rate,
      confidence: 0.6,
      summary: "结合上下文复核",
      evidence:
        rate === null
          ? []
          : [
              {
                startLine: 2,
                endLine: 2,
                quote: 'print("<script>alert(1)</script>")',
                explanation: "合成代码解释",
              },
            ],
      limitations: ["无法获取实际编写过程"],
      model: "DO-NOT-DISCLOSE-MODEL",
      modelCalls: 12345,
      generatedAt: "2026-10-25T01:00:00Z",
    },
  };
}
function report(rows = [row()]) {
  return {
    assignmentId: "2",
    language: "Python",
    selection: "latest_per_student",
    generatedAt: "2026-10-25T01:00:00Z",
    rows,
  };
}

test("AI rate classification handles boundaries and keeps insufficient evidence separate from zero", () => {
  for (const [rate, tone] of [
    [0, "low"],
    [29.99, "low"],
    [30, "moderate"],
    [49.99, "moderate"],
    [50, "suspected"],
    [79.99, "suspected"],
    [80, "high"],
    [100, "high"],
  ]) {
    assert.equal(api.aiRateBand(row("1", rate).result).tone, tone);
  }
  for (const result of [
    undefined,
    row("1", null).result,
    { ...row().result, aiRate: NaN },
    { ...row().result, aiRate: -1 },
    { ...row().result, aiRate: 101 },
    { ...row().result, status: "insufficient_evidence", aiRate: 0 },
  ]) {
    assert.equal(api.aiRateBand(result), undefined);
  }
});

test("display rounding cannot move a percentage into another tag interval", () => {
  for (const rate of [29.99, 49.99, 79.99])
    assert.equal(api.formatAIRate(row("1", rate).result), `${rate}%`);
  assert.equal(api.formatAIRate(row("1", 80).result), "80.0%");
  assert.equal(api.formatAIRate(row("1", null).result), "—");
});

test("filters classify rates, insufficient evidence and unfinished states independently", () => {
  const rows = [
    row("1", 0),
    row("2", 30),
    row("3", 50),
    row("4", 80),
    row("5", null),
    ...["pending", "running", "error", "stopped"].map((state, i) => ({
      source: row(String(i + 6)).source,
      state,
    })),
  ];
  for (const [filter, ids] of [
    ["low", ["1"]],
    ["moderate", ["2"]],
    ["suspected", ["3"]],
    ["high", ["4"]],
    ["insufficient", ["5"]],
    ["unfinished", ["6", "7", "8", "9"]],
  ]) {
    assert.deepEqual(
      Array.from(
        api.filterAIRows(rows, filter, "rate_desc"),
        (r) => r.source.id,
      ),
      ids,
    );
  }
  assert.deepEqual(JSON.parse(JSON.stringify(api.aiReportStats(rows))), {
    total: 9,
    completed: 5,
    estimated: 4,
    insufficient: 1,
    unfinished: 4,
  });
});

test("numeric sort keeps zero as a result, puts absent rates last and never mutates the snapshot", () => {
  const rows = [row("3", null), row("1", 0), row("2", 100)];
  assert.deepEqual(
    Array.from(api.filterAIRows(rows, "all", "rate_desc"), (r) => r.source.id),
    ["2", "1", "3"],
  );
  assert.deepEqual(
    Array.from(api.filterAIRows(rows, "all", "rate_asc"), (r) => r.source.id),
    ["1", "2", "3"],
  );
  assert.deepEqual(
    rows.map((r) => r.source.id),
    ["3", "1", "2"],
  );
});

test("exports escape every untrusted text field and omit model metadata", () => {
  const item = row();
  const attack =
    '</pre><img src=x onerror="alert(1)"><script>alert(2)</script>';
  item.source.studentName = attack;
  item.source.studentId = attack;
  item.source.id = attack;
  item.result.summary = attack;
  item.result.evidence[0].quote = attack;
  item.result.evidence[0].explanation = attack;
  item.result.limitations = [attack];
  const html = api.buildAIDetectionHTML(attack, {
    ...report([item]),
    assignmentId: attack,
    language: attack,
  });
  assert.doesNotMatch(
    html,
    /<script|<img|onerror="|DO-NOT-DISCLOSE-MODEL|modelCalls|识别模型|模型调用/,
  );
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

test("full reports preserve rate tags, confidence, source lines, limitations and partial failures", () => {
  const rows = [
    row("1", 0),
    row("2", 80),
    row("3", null),
    { source: row("4").source, state: "error", error: "AI 服务响应超时" },
    { source: row("5").source, state: "stopped" },
  ];
  const html = api.buildAIDetectionHTML("合成作业", report(rows));
  for (const text of [
    "0.0%",
    "80.0%",
    "高生成倾向",
    "证据不足",
    "判断置信度 60%",
    "第 2 行",
    "原始提交代码",
    "无法获取实际编写过程",
    "AI 服务响应超时",
    "已停止",
    "未完成 2 份",
    "包含本次全部提交",
    "不是实际 AI 生成代码占比",
    "证据不足单独标记",
    "第 2 行",
  ])
    assert.ok(html.includes(text), text);
  assert.match(html, /class="line"><b>2<\/b>/);
  assert.match(html, /@media print/);
  assert.match(html, /@page\{size:A4/);
});

test("reports include rows beyond the visible first page and explain selection", () => {
  const data = report(
    Array.from({ length: 28 }, (_, i) => row(String(i + 1), i)),
  );
  const html = api.buildAIDetectionHTML("合成作业", data);
  assert.equal((html.match(/<section id="submission-/g) || []).length, 28);
  assert.ok(html.includes("提交 #28"));
  const single = api.buildAIDetectionHTML("合成作业", {
    ...data,
    selection: "selected_submission",
    rows: [data.rows[0]],
  });
  assert.ok(single.includes("教师指定的单份提交"));
  assert.ok(single.includes("参与 1 份"));
});

test("download produces a standalone HTML file and releases its blob URL", () => {
  let filename,
    clicked = false,
    revoked,
    content,
    timer;
  const link = {
    click() {
      clicked = true;
      filename = this.download;
    },
  };
  const browser = load({
    Blob: class {
      constructor(parts) {
        content = parts.join("");
      }
    },
    URL: {
      createObjectURL() {
        return "blob:test";
      },
      revokeObjectURL(value) {
        revoked = value;
      },
    },
    document: {
      createElement() {
        return link;
      },
    },
    window: {
      setTimeout(callback) {
        timer = callback;
      },
    },
  });
  browser.downloadAIDetectionHTML("合成作业", report());
  assert.ok(clicked);
  assert.equal(filename, "AI生成识别-2-2026-10-25.html");
  assert.match(content, /<!doctype html>/);
  timer();
  assert.equal(revoked, "blob:test");
});

test("print uses the complete HTML report and cleans up after printing", () => {
  let printed = 0,
    removed = 0,
    attached;
  const frame = {
    style: {},
    setAttribute() {},
    remove() {
      removed++;
    },
    contentWindow: {
      print() {
        printed++;
      },
    },
  };
  const browser = load({
    document: {
      createElement() {
        return frame;
      },
      body: {
        appendChild(value) {
          attached = value;
        },
      },
    },
    window: { setTimeout() {} },
  });
  browser.printAIDetectionReport("合成作业", report());
  assert.equal(attached, frame);
  assert.match(frame.srcdoc, /AI 生成识别报告/);
  assert.doesNotMatch(frame.srcdoc, /DO-NOT-DISCLOSE-MODEL/);
  frame.onload();
  assert.equal(printed, 1);
  frame.contentWindow.onafterprint();
  assert.equal(removed, 1);
});
