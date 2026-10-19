const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const source = fs.readFileSync(
  path.join(__dirname, "../src/components/similarity/report.ts"),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const exportsObject = {};
vm.runInNewContext(compiled, { exports: exportsObject });
const { buildSimilarityHTML } = exportsObject;
function report() {
  const a = {
    id: "7",
    studentId: "3",
    studentName: "学生 A",
    submittedAt: "2026-10-17T00:00:00Z",
    code: 'context\nprint("<script>alert(1)</script>")\nlast',
    tokenCount: 30,
    excludedTokens: 8,
  };
  return {
    assignmentId: "2",
    language: "Python",
    selection: "selected_pair",
    generatedAt: "2026-10-17T01:00:00Z",
    version: "token-runs-v1",
    minTokens: 20,
    template: "",
    comparedPairs: 1,
    sources: [a, { ...a, id: "8", studentId: "4", studentName: "学生 B" }],
    pairs: [
      {
        a: "7",
        b: "8",
        similarity: 75,
        coverageA: 50,
        coverageB: 100,
        matchedTokens: 25,
        matches: [
          {
            a: { startLine: 2, endLine: 2 },
            b: { startLine: 2, endLine: 2 },
            tokens: 25,
            kind: "renamed",
          },
        ],
      },
    ],
  };
}
test("student code, names, title and template remain inert text in exported HTML", () => {
  const data = report();
  data.sources[0].studentName = "<img src=x onerror=alert(1)>";
  data.template = "</pre><script>alert(2)</script>";
  const html = buildSimilarityHTML("</title><script>alert(3)</script>", data);
  assert.doesNotMatch(html, /<script|<img|onerror="/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;\/pre&gt;/);
  assert.match(html, /class="line hit"><b>2<\/b>/);
});
test("report preserves coverage, IDs, evidence and insufficient-content outcome", () => {
  const data = report();
  const html = buildSimilarityHTML("测试作业", data);
  for (const text of [
    "提交 #7",
    "提交 #8",
    "相似度 75%",
    "A 覆盖率 50%",
    "B 覆盖率 100%",
    "第 2–2 行",
    "标识符替换后匹配",
    "token-runs-v1",
    "不自动扣分",
  ])
    assert.ok(html.includes(text), text);
  data.pairs[0].matches = [];
  data.sources[0].tokenCount = 5;
  const empty = buildSimilarityHTML("测试作业", data);
  assert.match(empty, /未发现达到最小连续长度/);
  assert.match(empty, /有效内容不足/);
});
test("classification boundaries are inclusive at 30, 50 and 80 percent", () => {
  for (const [score, label] of [
    [0, "低相似"],
    [29.99, "低相似"],
    [30, "部分相似"],
    [49.99, "部分相似"],
    [50, "疑似抄袭"],
    [79.99, "疑似抄袭"],
    [80, "高度疑似抄袭"],
    [100, "高度疑似抄袭"],
  ])
    assert.equal(exportsObject.similarityBand(score).label, label);
});
test("exports include the matching classification and explain default thresholds", () => {
  const data = report();
  data.pairs[0].similarity = 80;
  const html = buildSimilarityHTML("测试作业", data);
  assert.match(
    html,
    /相似度 80% <span class="risk risk-high">高度疑似抄袭<\/span>/,
  );
  assert.ok(html.includes("80% ≤ 相似度 ≤ 100%"));
  assert.ok(html.includes("相似度不代表抄袭概率"));
});
