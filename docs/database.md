# 数据库设计

[文档首页](README.md) · [项目首页](../README.md)

本文档对应当前后端实现。服务启动时先连接 MySQL、检查连通性，然后调用 GORM `AutoMigrate` 创建或增量更新表结构；当 `server/config.yaml` 中 `seed.enabled: true` 时，再从内置快照导入演示数据。账号、成绩和导出方法见[演示数据](demo-data.md)。

## 1. 数据库连接

连接配置位于 `server/config.yaml`：

```yaml
database:
  host: mysql # 后端在 Compose 内；宿主机运行时用 127.0.0.1
  port: 3306
  name: codeeval
  username: codeeval
  password: 数据库密码
  charset: utf8mb4
  max_idle_conns: 5
  max_open_conns: 20
  conn_max_lifetime_minutes: 30
```

启动顺序：

1. 根据配置生成 MySQL DSN。
2. 使用 GORM MySQL Driver 建立连接。
3. 使用 `PingContext` 在 10 秒内验证数据库可用性。
4. 设置最大空闲连接数、最大连接数和连接生命周期。
5. 执行 `AutoMigrate`。
6. 将未归属课程的已有作业按教师归入“编程实践”，自动加入已有提交的学生；重复启动不会重复迁移。旧版本自动生成且名称、说明均未修改的默认课程同步改为“编程实践”，保留课程 ID、作业和选课关系。
7. 根据 `seed.enabled` 决定是否导入评分快照、补齐课程与选课演示数据；新导入的演示作业优先归属“C++ 程序设计”，已有课程归属保持不变。随后处理仍未归属课程的历史作业。

## 2. 表关系

```text
users (teacher)
  └── course_records.teacher_id
        ├── enrollment_records.course_id → enrollment_records.student_id → users (student)
        └── assignment_records.course_id (teacher_id 保留发布教师)
        ├── test_case_records.assignment_id
        └── submission_records.assignment_id
              ├── submission_records.student_id → users (student)
              ├── evaluation_job_records.submission_id
              ├── review_records.submission_id
              └── expert_rating_records.submission_id
```

当前通过索引字段维护逻辑关联，尚未创建物理外键约束。

## 3. AutoMigrate 表结构

### users

| 字段 | 含义 | 约束/说明 |
| --- | --- | --- |
| `id` | 用户 ID | 自增主键 |
| `username` | 登录账号 | 最长 80，唯一索引 |
| `display_name` | 显示名称 | 例如“李老师” |
| `password_hash` | 密码哈希 | bcrypt 哈希，不保存明文密码 |
| `role` | 用户角色 | `teacher` 或 `student`，普通索引 |
| `created_at` | 创建时间 | GORM 自动写入 |

### course_records 与 enrollment_records

`course_records` 保存课程名称（`title`）、说明（`description`）、教师 ID（`teacher_id`）和创建时间。教师只管理自己的课程。

`enrollment_records` 使用 `(course_id, student_id)` 联合主键防止重复选课。学生只可选课，重复请求幂等；本次不提供退课。选课后可以访问课程已有作业，未选课学生无法通过作业详情或提交 API 访问该课程作业。

作业响应增加 `courseId`、`courseTitle`、`expectedStudents`、`submittedStudents` 和 `submissionRate`。应提交人数为当前选课人数；已提交人数为选课学生中有提交记录的去重人数，包含排队和评估失败的提交；提交率使用百分数（0–100），无人选课时为 `null`。名单接口返回每位学生的最近一次提交，尚未提交的学生同样保留。

### assignment_records

| 字段 | 含义 | 约束/说明 |
| --- | --- | --- |
| `id` | 作业 ID | 自增主键 |
| `course_id` | 所属课程 | 普通索引；新作业必须指定教师本人的课程，发布后不可转移 |
| `teacher_id` | 发布教师 ID | 普通索引，逻辑关联 `users.id` |
| `title` | 作业标题 | 必填 |
| `language` | 编程语言 | 如 Go、Python、Java、C++ |
| `description` | 作业要求 | TEXT |
| `status` | 提交状态 | `open` 或 `closed`，默认 `open` |
| `max_submissions` | 每名学生提交次数上限 | 1–100，默认 1 |
| `reference_solution` | 教师参考实现 | LONGTEXT；作业所有者可通过详情 API 查看，学生不可查看 |
| `knowledge_base` | 课程知识库、常见错误和评分边界 | LONGTEXT；作业所有者可通过详情 API 查看，学生不可查看 |
| `due_at` | 截止时间 | 本地时区时间 |
| `rubric_json` | 评分量规 | JSON，所有权重之和必须为 100 |
| `llm_evaluation_enabled` | 是否启用大模型评估 | 默认 `false`；为 `true` 时使用 DeepSeek Flash |
| `created_at` | 创建时间 | GORM 自动写入 |

评分量规 JSON 示例：

```json
[
  {"key":"correctness","name":"功能正确性","description":"通过公开与隐藏测试","weight":45},
  {"key":"robustness","name":"鲁棒性","description":"处理空输入、重复值和异常边界","weight":20},
  {"key":"quality","name":"代码质量","description":"结构、命名和可读性","weight":20},
  {"key":"efficiency","name":"算法效率","description":"时间和空间复杂度","weight":15}
]
```

### submission_records

| 字段 | 含义 | 约束/说明 |
| --- | --- | --- |
| `id` | 提交 ID | 自增主键 |
| `assignment_id` | 所属作业 ID | 普通索引，逻辑关联 `assignment_records.id` |
| `student_id` | 提交学生 ID | 普通索引，逻辑关联 `users.id` |
| `code` | 学生代码 | LONGTEXT |
| `status` | 评估状态 | `queued`、`evaluating`、`needs_review`、`graded` 或 `failed`；教师复核后为 `graded` |
| `evaluation_json` | 原始自动评估结果 | JSON，包含总分、维度得分、证据、置信度、第一阶段分析和评估器版本；教师复核与专家评分不会覆盖此字段 |
| `submitted_at` | 提交时间 | 由后端写入 |
| `progress` | 评估进度 | 0–100；已完成或失败时为 100 |

### test_case_records

教师配置的标准输入/输出测试。`hidden=true` 的输入与期望输出不会经作业 API 返回给学生；评估结果只保存用例名称、通过状态、退出码和耗时。

| 字段 | 含义 |
| --- | --- |
| `assignment_id` | 所属作业 |
| `name` | 用例名称；应用层要求同一作业内不重复 |
| `input`、`expected` | 标准输入与期望输出 |
| `hidden` | 是否为隐藏用例 |
| `weight` | 计算功能得分的相对权重 |
| `timeout_ms` | 单个用例时间限制，100–10000ms |

### evaluation_job_records

持久化评估任务队列。学生提交与队列任务在同一个数据库事务中创建，服务重启不会丢失尚未处理的作业。

| 字段 | 含义 | 约束/说明 |
| --- | --- | --- |
| `submission_id` | 待评估提交 | 唯一索引 |
| `assignment_id` | 作业 ID | 普通索引 |
| `student_id` | 学生 ID | 普通索引 |
| `status` | `queued`、`running`、`completed` 或 `failed` | 普通索引 |
| `attempts` | 已领取次数 | 达到配置上限后不再重试 |
| `locked_by`、`locked_at` | Worker 租约信息 | 用于并发领取和崩溃恢复 |
| `last_error` | 最近一次失败原因 | TEXT |

### review_records

教师复核历史只追加，不覆盖旧修订。API 返回提交时批量读取每份提交最新的复核为 `submission.review`；学生可查看自己的最新复核，完整复核历史仅作业发布教师可查看。

| 字段 | 含义 | 约束/说明 |
| --- | --- | --- |
| `id` | 复核版本 ID | 自增主键；同时用于并发版本检查 |
| `submission_id` | 被复核提交 | 普通索引，逻辑关联 `submission_records.id` |
| `reviewer_id`、`reviewer_name` | 复核教师及当时显示名称 | 只允许作业发布教师写入 |
| `comment` | 复核理由 | 必填；最多 4000 个字符 |
| `dimensions_json` | 人工维度评分及原量规快照 | JSON，包含 `key`、`name`、`score`、`maxScore` |
| `total`、`max_total` | 人工总分及满分 | 由服务端对维度分数求和 |
| `created_at` | 复核时间 | GORM 自动写入；历史按 ID 倒序返回 |

`POST /api/v1/submissions/:id/reviews` 请求：

```json
{
  "dimensions": [{"key":"correctness","score":45},{"key":"robustness","score":18},{"key":"quality","score":17},{"key":"efficiency","score":14}],
  "comment": "已核对边界输入和代码结构，调整代码质量得分。",
  "expectedReviewId": ""
}
```

首次复核时 `expectedReviewId` 必须为空字符串；后续修订必须传当前最新 `review.id`。写入事务先锁定提交行，再比较最新复核 ID；版本过期返回 409，不写入任何修订。成功返回附新复核的 Submission，并将提交 `status` 设为 `graded`、进度设为 100，原自动评估 JSON 保持不变。

### expert_rating_records

专家评分用于独立对照实验，不修改最终成绩，也不返回给学生。作业发布教师代为录入各位专家评分。同一提交、同一规范化专家身份更新同一条记录，避免重复计入样本。

| 字段 | 含义 | 约束/说明 |
| --- | --- | --- |
| `id` | 专家评分 ID | 自增主键；修订时保持不变 |
| `submission_id` | 评分对象 | 与 `expert_key` 组成唯一索引 `idx_submission_expert` |
| `recorded_by` | 录入教师 ID | 只允许作业发布教师写入 |
| `expert_name` | 专家姓名 | 1–80 个字符，NFKC 标准化并合并连续空白 |
| `expert_key` | 规范化姓名身份键 | 姓名再转小写后计算 SHA-256；全角、大小写和重复空白不产生重复专家 |
| `comment` | 专家评语 | 可选；最多 4000 个字符 |
| `dimensions_json` | 专家维度评分及原量规快照 | 与教师复核相同的评分结构 |
| `total`、`max_total` | 专家总分及满分 | 由服务端计算 |
| `duration_seconds` | 专家评分用时 | 0–86400 秒；0 表示未记录 |
| `created_at`、`updated_at` | 初次录入、最近修订时间 | 同一专家修订保留 `created_at` |

`POST /api/v1/submissions/:id/expert-ratings` 接受 `expertName`、`dimensions`、`comment`、`durationSeconds`，返回 ExpertRating。`GET /api/v1/submissions/:id/assessment` 返回 `{ "reviews": [], "expertRatings": [] }`，两组均按 ID 倒序。两类评分的读写接口均要求教师身份和作业归属；越权访问返回 404。

评分维度按该提交 **原始 `evaluation_json.dimensions` 的 key 和 maxScore** 校验，作业之后改量规不会改变旧提交的评分尺度。所有维度必须各出现一次，每项分数必须显式提供整数，范围为 0 到原满分；缺失或 null 不视为零。尚在排队或运行的提交/任务返回 409；没有原始评估量规的失败提交不能录入人工评分。接口不会把当前作业量规或模型推断分数当作人工输入补齐。

教师提交列表仅包含其发布作业中的提交；`GET /api/v1/assignments/:id/comparison` 返回该作业的 AI 与专家评分对照。其数据读取 `AssignmentComparisonData(assignmentID, teacherID)` 同样校验作业归属，并返回保留原自动评估的提交和按提交 ID 分组的独立专家评分。

## 4. 相关文档

- [演示数据](demo-data.md)：初始化开关、全部演示账号与密码、选课关系、九表清空重建、实际评分与快照导出。
- [提交与评估](evaluation.md)：评分语义、教师复核及专家对照口径。
- [开发与配置](development.md)：本地启动、数据库配置和检查命令。

## 课程接口

- `GET /api/v1/courses`：学生查看全部课程和本人选课状态，教师查看本人课程。
- `POST /api/v1/courses`：教师创建课程，字段 `title`、`description`。
- `POST /api/v1/courses/:id/enroll`：学生选课，重复选课不会增加人数。
- `GET /api/v1/courses/:id/students`：仅课程所属教师可查看全部选课学生，返回 `id`、`name`、`username`、`enrolledAt`；没有作业或提交的学生也包含在内。
- `POST /api/v1/assignments`：除既有字段外必须传入 `courseId`，并验证课程归属。
- `GET /api/v1/assignments`：仅返回教师本人或学生已选课程内的作业。
- `GET /api/v1/assignments/:id/students`：作业所有者查看选课学生及其最近提交。
