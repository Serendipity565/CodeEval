import { Icon } from "../ui";

export default function AssignmentActions({
  title,
  owner,
  edit,
  similarity,
  compare,
}: {
  title: string;
  owner: boolean;
  edit: () => void;
  similarity: () => void;
  compare: () => void;
}) {
  return (
    <div
      className="assignment-row-actions"
      role="group"
      aria-label={`${title}的操作`}
    >
      <button type="button" onClick={edit} title="查看作业内容与要求">
        <Icon name="arrowUpRight" />
        <span>查看作业</span>
      </button>
      {owner && (
        <>
          <button
            type="button"
            onClick={similarity}
            title="比对提交中的相似代码片段"
          >
            <Icon name="code" />
            <span>代码查重</span>
          </button>
          <button
            type="button"
            onClick={compare}
            title="比较自动评分与专家评分"
          >
            <Icon name="activity" />
            <span>评分对照</span>
          </button>
        </>
      )}
    </div>
  );
}
