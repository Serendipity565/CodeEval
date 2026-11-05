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

test("saved report reads use GET and regeneration must be explicit", async () => {
  const compiledAPI = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/api/ai-detection.ts"), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exports = {};
  const requests = [];
  const saved = { results: [{ submissionId: "7", aiRate: 62 }] };
  vm.runInNewContext(compiledAPI, {
    exports,
    require: () => ({
      apiRequest: async (...args) => {
        requests.push(args);
        return saved;
      },
    }),
  });
  const signal = new AbortController().signal;
  const result = await exports.getSavedAIDetections(
    "token",
    "2",
    undefined,
    signal,
  );
  assert.equal(result, saved);
  assert.equal(requests[0][0], "/assignments/2/ai-detection");
  assert.equal(requests[0][2].method, undefined);
  assert.equal(requests[0][2].signal, signal);
  await exports.getSavedAIDetections("token", "2", "7", signal);
  assert.equal(requests[1][0], "/assignments/2/ai-detection?submissionId=7");
  await exports.detectAICode("token", "2", "7", signal);
  assert.equal(requests[2][2].method, "POST");
  assert.deepEqual(JSON.parse(requests[2][2].body), {
    submissionId: "7",
    regenerate: false,
  });
  await exports.detectAICode("token", "2", "7", signal, true);
  assert.deepEqual(JSON.parse(requests[3][2].body), {
    submissionId: "7",
    regenerate: true,
  });
  assert.equal(requests[3][2].signal, signal);
});

test("sample library reads never generate and explicit generation uses its own endpoint", async () => {
  const output = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/api/ai-detection.ts"), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exports = {};
  const calls = [];
  vm.runInNewContext(output, {
    exports,
    require: () => ({
      apiRequest: async (...args) => {
        calls.push(args);
        return { status: "missing", bank: null, expectedCount: 3 };
      },
    }),
  });
  const signal = new AbortController().signal;
  await exports.getAISampleLibrary("token", "2", signal);
  await exports.generateAISampleLibrary("token", "2", signal);
  assert.equal(calls[0][0], "/assignments/2/ai-samples");
  assert.equal(calls[0][2].method, undefined);
  assert.equal(calls[1][2].method, "POST");
  assert.equal(calls[1][2].signal, signal);
});
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

test("reports preserve actual verification facts, escape them and identify legacy reports", () => {
  const current = row("1");
  current.result.checks = [
    "运行核验：复用本份提交已保存的沙箱结果。测试通过 1/2。",
    "参考比对：已完成词元比对，相似度 80%。",
    "提交历史：提供此前 3 份版本。",
    '<script>alert("unsafe")</script>',
  ];
  const html = api.buildAIDetectionHTML("测试", report([current, row("2")]));
  assert.match(html, /核验材料/);
  assert.match(html, /测试通过 1\/2/);
  assert.match(html, /相似度 80%/);
  assert.match(html, /提供此前 3 份版本/);
  assert.match(
    html,
    /&lt;script&gt;alert\(&quot;unsafe&quot;\)&lt;\/script&gt;/,
  );
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /此报告未记录核验材料/);
  assert.match(html, /请重新生成/);
  assert.match(html, /未被测试覆盖的缺陷仅为静态推测/);
});

test("execution snapshots show failures, escape outputs and protect hidden cases", () => {
  const current = row("1");
  current.result.execution = {
    compileOk: false,
    compileError: "<script>compile()</script>",
    passed: 0,
    total: 2,
    results: [
      {
        name: "edge<script>",
        passed: false,
        exitCode: 1,
        durationMs: 10,
        input: "1",
        expected: "2",
        actual: "<script>output()</script>",
        error: "<error>",
      },
      {
        name: "hidden",
        hidden: true,
        passed: false,
        exitCode: 1,
        durationMs: 10,
        input: "SECRET-INPUT",
        expected: "SECRET-EXPECTED",
        actual: "SECRET-ACTUAL",
      },
    ],
  };
  const html = api.buildAIDetectionHTML("测试", report([current]));
  assert.match(html, /测试结果快照/);
  assert.match(html, /测试通过 0\/2/);
  assert.match(html, /&lt;script&gt;compile\(\)&lt;\/script&gt;/);
  assert.match(html, /&lt;script&gt;output\(\)&lt;\/script&gt;/);
  assert.match(html, /隐藏用例，输入与输出不公开/);
  assert.doesNotMatch(html, /SECRET-|<script>/);
});

test("conclusions lead with a clear tendency and empty supplementary notes do not add boilerplate", () => {
  const item = row("1", 72.5);
  item.result.limitations = [];
  const html = api.buildAIDetectionHTML("测试", report([item]));
  assert.match(html, /识别结论：较高生成倾向/);
  assert.doesNotMatch(html, /<h3>补充说明<\/h3>|判断局限/);
  assert.equal((html.match(/AI 率是来源倾向估计/g) || []).length, 1);
  assert.ok(
    html.indexOf("识别结论：较高生成倾向") < html.indexOf("<h3>代码依据"),
  );
});

test("multi-dimension reports preserve calculation, exclusions and counterevidence without legacy confidence", () => {
  const item = row();
  item.result.scoringVersion = "dimensions-v1";
  item.result.coverage = 0.7;
  item.result.dimensions = [
    {
      key: "task_fit",
      label: "题目与实现契合",
      weight: 30,
      status: "assessed",
      score: 3,
      effectiveScore: 3,
      strength: "strong",
      reason: "存在需复核的组合特征",
      alternative: "人工实现也可能出现",
      evidence: [{ ...item.result.evidence[0], counted: true }],
      included: true,
    },
    {
      key: "structure",
      label: "代码结构与表达",
      weight: 40,
      status: "assessed",
      score: 3,
      effectiveScore: 1,
      strength: "weak",
      reason: "风格线索弱",
      alternative: "规范编程习惯",
      evidence: [{ ...item.result.evidence[0], counted: false }],
      included: true,
    },
    {
      key: "comments",
      label: "注释与代码关系",
      weight: 30,
      status: "insufficient_evidence",
      score: null,
      effectiveScore: null,
      strength: "none",
      reason: "没有注释",
      alternative: "",
      evidence: [],
      included: false,
      exclusionReason: "缺少证据",
    },
  ];
  item.result.aggregationNotes = ["按参与维度归一化", "弱证据最多计1分"];
  const html = api.buildAIDetectionHTML("测试", report([item]));
  for (const text of [
    "多维度分析",
    "3 / 4",
    "1 / 4",
    "不计分",
    "基础权重 30%",
    "分析原始分 3/4",
    "反向解释：人工实现也可能出现",
    "未计分原因：缺少证据",
    "重复或公共框架引用，不计分",
    "维度覆盖率 70%",
    "综合评分规则",
    "按参与维度归一化",
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /判断置信度 60%|旧版报告：|<h3>代码依据<\/h3>/);
  assert.equal(api.aiAnalysisLabel(item.result), "维度覆盖率 70%");
  assert.equal(api.aiDimensionScoreLabel(item.result.dimensions[2]), "不计分");
  assert.equal(
    api.aiAnalysisLabel({ ...item.result, coverage: undefined }),
    "维度覆盖率 0%",
  );
  const attack = '</p><script>alert("dimension")</script>';
  const d = item.result.dimensions[0];
  d.label = d.reason = d.alternative = d.exclusionReason = attack;
  d.evidence[0].quote = d.evidence[0].explanation = attack;
  item.result.aggregationNotes = [attack];
  const escaped = api.buildAIDetectionHTML("测试", report([item]));
  assert.doesNotMatch(escaped, /<script>/);
  assert.match(
    escaped,
    /&lt;script&gt;alert\(&quot;dimension&quot;\)&lt;\/script&gt;/,
  );
});

test("old saved reports are explicitly identified and new insufficient reports never display a percentage", () => {
  const oldHTML = api.buildAIDetectionHTML("旧报告", report([row()]));
  assert.match(oldHTML, /旧版报告：总分为模型直接估计/);
  const item = row("1", null);
  item.result.scoringVersion = "dimensions-v1";
  item.result.dimensions = [];
  const html = api.buildAIDetectionHTML("新报告", report([item]));
  assert.match(html, /维度覆盖率 0%/);
  assert.match(html, /AI 率（估计）：—/);
  assert.doesNotMatch(html, /判断置信度 60%|旧版报告：/);
});

test("five-dimension reports preserve sample and prior-version source comparisons and escape every new field", () => {
  const item = row();
  item.result.scoringVersion = "dimensions-v2";
  item.result.coverage = 1;
  const evidence = {
    ...item.result.evidence[0],
    counted: true,
    sourceId: "ai-sample-1",
    sourceStartLine: 5,
    sourceEndLine: 6,
    sourceQuote: "print(value)",
  };
  item.result.dimensions = [
    "task_fit",
    "structure",
    "comments",
    "sample_match",
    "history",
  ].map((key, i) => ({
    key,
    label: [
      "题目与实现契合",
      "代码结构与表达",
      "注释与代码关系",
      "同题 AI 样本匹配",
      "学生历史与提交演变",
    ][i],
    weight: 20,
    status: "assessed",
    score: 3,
    effectiveScore: 3,
    strength: "moderate",
    reason: "分析事实",
    alternative: "人工解释",
    evidence:
      i >= 3 ? [{ ...evidence, sourceId: i === 3 ? "ai-sample-1" : "6" }] : [],
    included: true,
  }));
  item.result.sampleComparison = {
    status: "compared",
    note: "样本未经过沙箱验证",
    samples: [
      {
        id: "ai-sample-1",
        approach: "直接实现",
        pair: { similarity: 81.25, matchedTokens: 42 },
      },
    ],
  };
  const html = api.buildAIDetectionHTML("五维度", report([item]));
  for (const text of [
    "同题 AI 样本匹配",
    "学生历史与提交演变",
    "对照 ai-sample-1",
    "对照 6",
    "第 5–6 行",
    "同题 AI 样本比对记录",
    "81.3%",
    "匹配 42 个词元",
    "维度覆盖率 100%",
    "样本未经过沙箱验证",
  ])
    assert.ok(html.includes(text), text);
  assert.equal((html.match(/基础权重 20%/g) || []).length, 5);
  assert.doesNotMatch(html, /此报告使用三维度规则/);
  const attack = '<script>alert("source")</script>';
  item.result.dimensions[3].evidence[0].sourceId = attack;
  item.result.dimensions[3].evidence[0].sourceQuote = attack;
  item.result.sampleComparison.note = attack;
  item.result.sampleComparison.samples[0].id = attack;
  item.result.sampleComparison.samples[0].approach = attack;
  const escaped = api.buildAIDetectionHTML("测试", report([item]));
  assert.doesNotMatch(escaped, /<script>/);
  assert.match(
    escaped,
    /&lt;script&gt;alert\(&quot;source&quot;\)&lt;\/script&gt;/,
  );
});

test("v3 separates coverage, low scores and evidence strength while retaining old rule warnings", () => {
  const item = row("1", 0);
  item.result.scoringVersion = "dimensions-v3";
  item.result.coverage = 0.6;
  item.result.dimensions = [
    "task_fit",
    "structure",
    "comments",
    "sample_match",
    "history",
  ].map((key, i) => ({
    key,
    label: key,
    weight: 20,
    status: i < 3 ? "assessed" : "insufficient_evidence",
    score: i < 3 ? 0 : null,
    effectiveScore: i < 3 ? 0 : null,
    strength: i < 3 ? "weak" : "none",
    reason: "事实支持人工解释",
    alternative: "其他解释",
    evidence: [],
    included: i < 3,
  }));
  assert.equal(api.aiAnalysisLabel(item.result), "可用维度 3/5 · 权重覆盖 60%");
  assert.equal(api.aiDimensionScoreLabel(item.result.dimensions[0]), "0 / 4");
  assert.equal(api.aiDimensionStrengthLabel("weak"), "证据强度：弱");
  const html = api.buildAIDetectionHTML("新规则", report([item]));
  assert.match(html, /可用维度 3\/5 · 权重覆盖 60%/);
  assert.match(html, /证据强度：弱/);
  assert.match(html, /证据强度：无可用证据/);
  assert.match(html, /每维满分 4 分/);
  assert.match(html, /不改变得分或决定是否出分/);
  assert.doesNotMatch(html, /证据强度曾影响出分和分数上限/);
  const before = JSON.stringify(item.result);
  api.buildAIDetectionHTML("新规则", report([item]));
  assert.equal(JSON.stringify(item.result), before);
  item.result.scoringVersion = "dimensions-v2";
  assert.match(
    api.buildAIDetectionHTML("旧规则", report([item])),
    /此报告使用旧评分规则，证据强度曾影响出分和分数上限/,
  );
  assert.equal(item.result.aiRate, 0);
});

test("v4 ten-point scale renders full and partial scores without reinterpreting four-point reports", () => {
  const item = row("1", 60);
  item.result.scoringVersion = "dimensions-v4";
  item.result.coverage = 0.6;
  item.result.dimensions = [3, 6, 9].map((score, i) => ({
    key: ["task_fit", "structure", "comments"][i],
    label: `维度${i + 1}`,
    weight: 20,
    status: "assessed",
    score,
    effectiveScore: score,
    strength: "weak",
    reason: "事实与解释",
    alternative: "人工解释",
    evidence: [],
    included: true,
  }));
  const before = JSON.stringify(item.result);
  assert.equal(api.aiDimensionMaxScore(item.result), 10);
  assert.equal(
    api.aiDimensionScoreLabel(item.result.dimensions[0], item.result),
    "3 / 10",
  );
  const html = api.buildAIDetectionHTML("10分制", report([item]));
  for (const score of [3, 6, 9]) assert.ok(html.includes(`${score} / 10`));
  assert.match(html, /每维满分 10 分/);
  assert.match(html, /可用维度 3\/3 · 权重覆盖 60%/);
  assert.doesNotMatch(html, /满分 4 分|3 \/ 4|6 \/ 4|9 \/ 4/);
  assert.equal(JSON.stringify(item.result), before);
  item.result.dimensions[0].score =
    item.result.dimensions[0].effectiveScore = 10;
  assert.equal(
    api.aiDimensionScoreLabel(item.result.dimensions[0], item.result),
    "10 / 10",
  );
  item.result.scoringVersion = "dimensions-v3";
  item.result.dimensions[0].score =
    item.result.dimensions[0].effectiveScore = 3;
  assert.equal(api.aiDimensionMaxScore(item.result), 4);
  assert.equal(
    api.aiDimensionScoreLabel(item.result.dimensions[0], item.result),
    "3 / 4",
  );
  assert.match(
    api.buildAIDetectionHTML("旧量表", report([item])),
    /每维满分 4 分的旧量表/,
  );
  assert.equal(item.result.aiRate, 60);
});

test("v5 uses percentage dimensions and preserves both historical scoring scales", () => {
  const item = row("1", 43.3);
  item.result.scoringVersion = "dimensions-v5";
  item.result.coverage = 0.6;
  item.result.dimensions = [41, 44, 45].map((score, i) => ({
    key: ["task_fit", "structure", "comments"][i],
    label: `维度${i + 1}`,
    weight: 20,
    status: "assessed",
    score,
    effectiveScore: score,
    strength: "weak",
    reason: "事实与解释",
    alternative: "人工解释",
    evidence: [],
    included: true,
  }));
  const before = JSON.stringify(item.result);
  assert.equal(api.aiDimensionMaxScore(item.result), 100);
  assert.equal(
    api.aiDimensionScoreLabel(item.result.dimensions[0], item.result),
    "41%",
  );
  const html = api.buildAIDetectionHTML("百分比", report([item]));
  for (const value of [41, 44, 45]) assert.ok(html.includes(`${value}%`));
  assert.match(html, /各维度使用 0–100%/);
  assert.match(html, /可用维度 3\/3 · 权重覆盖 60%/);
  assert.doesNotMatch(html, /满分 10 分|41 \/ 100|44 \/ 100/);
  assert.equal(JSON.stringify(item.result), before);
  for (const value of [0, 100]) {
    item.result.dimensions[0].effectiveScore = value;
    assert.equal(
      api.aiDimensionScoreLabel(item.result.dimensions[0], item.result),
      `${value}%`,
    );
  }
  for (const [version, denominator] of [
    ["dimensions-v3", 4],
    ["dimensions-v4", 10],
  ]) {
    item.result.scoringVersion = version;
    item.result.dimensions[0].score =
      item.result.dimensions[0].effectiveScore = 3;
    assert.equal(
      api.aiDimensionScoreLabel(item.result.dimensions[0], item.result),
      `3 / ${denominator}`,
    );
    assert.match(
      api.buildAIDetectionHTML("旧量表", report([item])),
      /重新检测后使用 0–100% 百分比量表/,
    );
    assert.equal(item.result.aiRate, 43.3);
  }
});

test("sample preparation refuses partial banks before analysis and surfaces failures", async () => {
  const compiledAPI = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/api/ai-detection.ts"), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exports = {};
  let response = {
    status: "partial",
    expectedCount: 3,
    bank: { samples: [{ id: "ai-sample-1" }] },
  };
  const calls = [];
  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }
  vm.runInNewContext(compiledAPI, {
    exports,
    require: () => ({
      ApiError,
      apiRequest: async (...args) => {
        calls.push(args);
        return response;
      },
    }),
  });
  const signal = new AbortController().signal;
  await assert.rejects(
    exports.prepareAISampleLibrary("token", "1", signal),
    /本批识别未开始/,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/assignments/1/ai-samples");
  assert.equal(calls[0][2].method, "POST");
  assert.equal(calls[0][2].signal, signal);
  response = {
    status: "ready",
    expectedCount: 3,
    bank: { samples: [{ id: "1" }, { id: "2" }, { id: "3" }] },
  };
  assert.equal(
    await exports.prepareAISampleLibrary("token", "1", signal),
    response,
  );
  response = { ...response, bank: { samples: [] } };
  await assert.rejects(
    exports.prepareAISampleLibrary("token", "1", signal),
    /尚未全部就绪/,
  );
});

test("sample availability is distinguished from no matching evidence", () => {
  const item = row();
  assert.equal(api.aiSampleAnalysisLabel(item.result), "本报告未完成样本比对");
  item.result.sampleComparison = {
    status: "compared",
    samples: [1, 2, 3].map((i) => ({
      id: `sample-${i}`,
      pair: { matchedTokens: 0 },
    })),
  };
  assert.equal(
    api.aiSampleAnalysisLabel(item.result),
    "已比对 3 份样本，未找到符合条件的匹配片段",
  );
  item.result.sampleComparison.samples[1].pair.matchedTokens = 26;
  assert.equal(
    api.aiSampleAnalysisLabel(item.result),
    "已比对 3 份样本，匹配是否计分见具体依据",
  );
});

test("excluded sample dimension names the counted owner and exact lines instead of blaming weak strength", () => {
  const item = row();
  item.result.scoringVersion = "dimensions-v5";
  const evidence = {
    startLine: 7,
    endLine: 8,
    quote: "vector<int> values(n);\nread(values);",
    explanation: "输入片段",
  };
  const owner = {
    key: "structure",
    label: "代码结构与表达",
    included: true,
    status: "assessed",
    score: 55,
    effectiveScore: 55,
    strength: "weak",
    weight: 20,
    reason: "结构",
    alternative: "人工解释",
    evidence: [{ ...evidence, counted: true }],
  };
  const sample = {
    ...owner,
    key: "sample_match",
    label: "同题 AI 样本匹配",
    score: 40,
    effectiveScore: null,
    included: false,
    exclusionReason: "引用重复或公共框架",
    evidence: [
      { ...evidence, counted: false },
      { ...evidence, counted: false },
    ],
  };
  item.result.dimensions = [owner, sample];
  item.result.sampleComparison = {
    status: "compared",
    samples: [1, 2, 3].map((i) => ({
      id: `sample-${i}`,
      pair: { matchedTokens: i === 2 ? 0 : 21 },
    })),
  };
  const before = JSON.stringify(item.result);
  const label = api.aiSampleAnalysisLabel(item.result);
  assert.match(
    label,
    /已比对 3 份样本；未计分：与「代码结构与表达」第 7–8 行引用重复/,
  );
  assert.equal((label.match(/代码结构与表达/g) || []).length, 1);
  assert.doesNotMatch(label, /证据强度|见具体依据/);
  assert.equal(api.aiDimensionScoreLabel(sample, item.result), "不计分");
  assert.equal(sample.score, 40);
  assert.equal(JSON.stringify(item.result), before);
  owner.strength = "strong";
  assert.equal(api.aiSampleAnalysisLabel(item.result), label);
  owner.evidence[0].counted = false;
  assert.match(
    api.aiSampleAnalysisLabel(item.result),
    /未计分：引用重复或公共框架/,
  );
});

test("v6 retains weak and overlapping dimension values and distinguishes unknown from zero", () => {
  const item = row("7", 52.3);
  item.result.scoringVersion = "dimensions-v6";
  item.result.recalculatedFromVersion = "dimensions-v5";
  item.result.coverage = 0.6;
  const evidence = {
    startLine: 7,
    endLine: 8,
    quote: "vector<int> values(n);\nread(values);",
    explanation: "verified source",
    counted: true,
  };
  item.result.dimensions = [62, 55, 40, null, null].map((score, i) => ({
    key: ["task_fit", "structure", "sample_match", "comments", "history"][i],
    label: `维度${i + 1}`,
    weight: 20,
    status: score === null ? "insufficient_evidence" : "assessed",
    score,
    effectiveScore: score,
    strength: score === null ? "none" : "weak",
    included: score !== null,
    reason: "原始分析",
    alternative: "其他解释",
    evidence: score === null ? [] : [{ ...evidence }],
    exclusionReason: score === null ? "缺少可用材料，无法判断" : "",
  }));
  item.result.sampleComparison = {
    status: "compared",
    note: "样本匹配",
    samples: [1, 2, 3].map((i) => ({
      id: `sample-${i}`,
      approach: `样本${i}`,
      pair: { similarity: 13.46, matchedTokens: 21 },
    })),
  };
  assert.equal(
    api.aiDimensionScoreLabel(item.result.dimensions[2], item.result),
    "40%",
  );
  assert.equal(
    api.aiDimensionScoreLabel(item.result.dimensions[3], item.result),
    "无法判断",
  );
  assert.equal(
    api.aiSampleAnalysisLabel(item.result),
    "已比对 3 份样本；本维度参与综合计算",
  );
  assert.equal(api.aiAnalysisLabel(item.result), "可用维度 3/5 · 权重覆盖 60%");
  assert.match(
    api.aiScoringVersionNote(item.result),
    /未重新调用 AI，原始报告保留/,
  );
  const before = JSON.stringify(item.result);
  const html = api.buildAIDetectionHTML("新计分规则", report([item]));
  assert.match(html, /40%/);
  assert.match(html, /本维度参与综合计算/);
  assert.match(html, /无法判断原因/);
  assert.doesNotMatch(
    html,
    /不计分|不重复计入综合结果|旧规则报告 · 重新生成后更新/,
  );
  assert.equal(JSON.stringify(item.result), before);
  item.result.dimensions[2].score =
    item.result.dimensions[2].effectiveScore = 0;
  assert.equal(
    api.aiDimensionScoreLabel(item.result.dimensions[2], item.result),
    "0%",
  );
});

test("v7 zero matching statistics retain the independent LLM assessment and strength", () => {
  const item = row("7", 15.3);
  item.result.scoringVersion = "dimensions-v7";
  item.result.coverage = 0.6;
  item.result.dimensions = [
    {
      key: "sample_match",
      label: "同题 AI 样本匹配",
      weight: 20,
      status: "assessed",
      score: 37,
      effectiveScore: 37,
      strength: "weak",
      included: true,
      evidenceBasis: "sample_comparison",
      reason: "三份样本最高匹配率为0%，AI结合整体实现给出37%的生成倾向值。",
      alternative: "零匹配不证明人工来源",
      evidence: [],
    },
  ];
  item.result.sampleComparison = {
    status: "compared",
    note: "完整比对",
    samples: [1, 2, 3].map((i) => ({
      id: `sample-${i}`,
      approach: `样本${i}`,
      pair: { similarity: 0, matchedTokens: 0 },
    })),
  };
  assert.equal(
    api.aiDimensionScoreLabel(item.result.dimensions[0], item.result),
    "37%",
  );
  assert.equal(
    api.aiSampleAnalysisLabel(item.result),
    "已比对 3 份样本；最高匹配率 0.00%；生成倾向由 AI 分析评分，参与综合计算",
  );
  const html = api.buildAIDetectionHTML("零匹配验收", report([item]));
  assert.match(html, /最高匹配率 0.00%；生成倾向由 AI 分析评分，参与综合计算/);
  assert.match(html, /同题 AI 样本匹配 · 37%/);
  assert.match(html, /证据强度：弱/);
  assert.match(html, /匹配率不直接充当维度分数/);
  assert.doesNotMatch(
    html,
    /同题 AI 样本匹配 · 无法判断|同题 AI 样本匹配 · 不计分|未找到符合条件的匹配片段|旧规则报告 · 重新生成后更新/,
  );
  assert.equal(item.result.dimensions[0].evidence.length, 0);
});
