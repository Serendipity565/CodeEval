const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const compiled = ts.transpileModule(
  fs.readFileSync(
    path.join(__dirname, "../src/components/editor/templates.ts"),
    "utf8",
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;
const api = {};
vm.runInNewContext(compiled, { exports: api });

test("student editor uses the supplied framework verbatim instead of a generic template", () => {
  const framework =
    "class Scheduler:\n    def handle(self, event):\n        # TODO\n        raise NotImplementedError\n";
  assert.equal(api.editorTemplate("Python", framework), framework);
});

test("assignments without a framework retain their language entrypoint", () => {
  assert.equal(
    api.editorTemplate("Python", "  \n"),
    api.editorTemplate("Python"),
  );
  assert.match(api.editorTemplate("Java"), /public class Main/);
});
