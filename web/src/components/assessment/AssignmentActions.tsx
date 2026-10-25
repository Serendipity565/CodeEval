import { Icon } from "../ui";

export default function AssignmentActions({
  title,
  owner,
  edit,
  similarity,
}: {
  title: string;
  owner: boolean;
  edit: () => void;
  similarity: () => void;
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
            title="比对代码相似片段，识别 AI 生成倾向"
          >
            <Icon name="code" />
            <span>代码检测</span>
          </button>
        </>
      )}
    </div>
  );
}
