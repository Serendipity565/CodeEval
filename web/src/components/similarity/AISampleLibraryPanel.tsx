import { useEffect, useRef, useState } from "react";
import {
  generateAISampleLibrary,
  getAISampleLibrary,
} from "../../api/ai-detection";
import type { AISampleLibrary } from "../../types";
import { Icon } from "../ui";
import CodeEditor from "../editor/CodeEditor";

export default function AISampleLibraryPanel({
  token,
  assignmentId,
  language,
  refreshKey,
  disabled,
  lastFailure,
}: {
  token: string;
  assignmentId: string;
  language: string;
  refreshKey: string;
  disabled: boolean;
  lastFailure?: string;
}) {
  const [library, setLibrary] = useState<AISampleLibrary>();
  const [reading, setReading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [reload, setReload] = useState(0);
  const action = useRef<AbortController | null>(null);
  useEffect(() => () => action.current?.abort(), [assignmentId, token]);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const result = await getAISampleLibrary(
          token,
          assignmentId,
          abort.signal,
        );
        if (!abort.signal.aborted) {
          setLibrary(result);
          setReading(false);
          setReadError("");
        }
      } catch (e) {
        if (!abort.signal.aborted) {
          setReadError(e instanceof Error ? e.message : "读取同题样本失败");
          setReading(false);
        }
      }
      if (!abort.signal.aborted && generating)
        timer = setTimeout(() => void read(), 3000);
    }
    void read();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [token, assignmentId, refreshKey, reload, generating]);
  async function generate() {
    const abort = new AbortController();
    action.current = abort;
    setError("");
    setGenerating(true);
    try {
      const result = await generateAISampleLibrary(
        token,
        assignmentId,
        abort.signal,
      );
      if (!abort.signal.aborted) setLibrary(result);
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : "生成同题样本失败");
    } finally {
      if (!abort.signal.aborted) {
        setGenerating(false);
        setReload((v) => v + 1);
      }
    }
  }
  const samples = library?.bank?.samples ?? [];
  return (
    <section className="ai-sample-library" aria-label="同题 AI 样本库">
      <div className="ai-sample-library-heading">
        <h3>同题 AI 样本库</h3>
        <div
          className={`ai-sample-library-meta${library?.status === "ready" ? " is-ready" : ""}`}
          role="status"
        >
          {library?.status === "ready" && <Icon name="check" />}
          <span>
            {reading
              ? "正在读取…"
              : library?.status === "ready"
                ? `${samples.length} / ${library.expectedCount} 份已就绪`
                : `已保存 ${samples.length} / ${library?.expectedCount ?? 3} 份`}
          </span>
          {generating && <span>正在逐份生成…</span>}
        </div>
        {library?.status !== "ready" && !generating && (
          <button
            className="submission-action"
            disabled={reading || disabled}
            onClick={() => void generate()}
          >
            {samples.length ? "继续生成缺失样本" : "生成同题 AI 样本"}
          </button>
        )}
        <button
          className="text-action ai-sample-refresh"
          disabled={generating}
          onClick={() => setReload((v) => v + 1)}
        >
          <Icon name="refresh" />
          刷新样本
        </button>
      </div>
      <p className="ai-sample-library-description">
        用于辅助比对，不作为标准答案。
      </p>
      {(error || readError || (library?.status !== "ready" && lastFailure)) && (
        <p role="alert">{error || readError || lastFailure}</p>
      )}
      {!reading &&
        !generating &&
        samples.length === 0 &&
        !error &&
        !readError && <p>本题尚无已保存的 AI 样本。</p>}
      {samples.length > 0 && (
        <div className="ai-sample-source-list">
          {samples.map((sample, index) => (
            <details className="ai-sample-source" key={sample.id}>
              <summary>
                <span className="ai-sample-file-icon" aria-hidden="true">
                  <Icon name="code" />
                </span>
                <span className="ai-sample-source-info">
                  <span className="ai-sample-source-title">
                    {sample.approach}
                  </span>
                  <span className="ai-sample-source-meta">
                    <span>样本 {index + 1}</span>
                    <span>
                      {sample.code.replace(/\r\n/g, "\n").split("\n").length} 行
                    </span>
                  </span>
                </span>
                <span className="ai-sample-source-action">
                  <span className="ai-sample-when-closed">查看代码</span>
                  <span className="ai-sample-when-open">收起代码</span>
                </span>
                <Icon
                  name="chevronRight"
                  className="ai-sample-source-chevron"
                />
              </summary>
              <div className="ai-sample-code">
                <CodeEditor
                  language={language}
                  value={sample.code}
                  readOnly
                  label={`样本 ${index + 1} · ${sample.approach}`}
                />
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
