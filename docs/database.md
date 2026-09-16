# CodeEval 数据库设计与 Mock 数据

本文档对应当前后端实现。服务启动时先连接 MySQL、检查连通性，然后调用 GORM `AutoMigrate` 创建或增量更新表结构；当 `server/config.yaml` 中 `seed.enabled: true` 时，再写入开发用 Mock 数据。

## 1. 数据库连接

连接配置位于 `server/config.yaml`：

```yaml
database:
  host: 服务器 IP 或域名
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
6. 根据 `seed.enabled` 决定是否初始化 Mock 数据。

## 2. 表关系

```text
users (teacher)
  └── assignment_records.teacher_id
        ├── test_case_records.assignment_id
        └── submission_records.assignment_id
              └── submission_records.student_id → users (student)
                    └── evaluation_jobs.submission_id → submission_records.id
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

### assignment_records

| 字段 | 含义 | 约束/说明 |
| --- | --- | --- |
| `id` | 作业 ID | 自增主键 |
| `teacher_id` | 发布教师 ID | 普通索引，逻辑关联 `users.id` |
| `title` | 作业标题 | 必填 |
| `language` | 编程语言 | 如 Go、Python、Java、C++ |
| `description` | 作业要求 | TEXT |
| `reference_solution` | 教师参考实现 | LONGTEXT，仅后端评估智能体读取，不通过作业 API 返回 |
| `knowledge_base` | 课程知识库、常见错误和评分边界 | LONGTEXT，仅后端评估智能体读取，不通过作业 API 返回 |
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
| `status` | 评估状态 | 当前使用 `graded` |
| `evaluation_json` | 评估结果 | JSON，包含总分、维度得分、证据、置信度、第一阶段分析和评估器版本 |
| `submitted_at` | 提交时间 | 由后端写入 |

### test_case_records

教师配置的标准输入/输出测试。`hidden=true` 的输入与期望输出不会经作业 API 返回给学生；评估结果只保存用例名称、通过状态、退出码和耗时。

| 字段 | 含义 |
| --- | --- |
| `assignment_id` | 所属作业 |
| `name` | 用例名称，作业内唯一 |
| `input`、`expected` | 标准输入与期望输出 |
| `hidden` | 是否为隐藏用例 |
| `weight` | 计算功能得分的相对权重 |
| `timeout_ms` | 单个用例时间限制，100–10000ms |

### evaluation_jobs

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

## 4. Mock 数据

Mock 数据统一定义在 `server/internal/store/mock_data.go`，使用事务写入，并通过稳定业务键查询后再创建，因此重复启动不会产生重复记录。数据库自动生成的主键和相对时间不固定。

### 用户

| 账号 | 显示名称 | 角色 | 开发环境密码 |
| --- | --- | --- | --- |
| `teacher` | 李老师 | `teacher` | `CodeEval123!` |
| `student` | 张同学 | `student` | `CodeEval123!` |

密码进入数据库前使用 bcrypt 加密，`password_hash` 的具体值每次首次生成时不同。

### 示例作业

| 属性 | 值 |
| --- | --- |
| 标题 | 两数之和：返回下标 |
| 发布者 | 李老师 |
| 语言 | Go |
| 描述 | 实现 `twoSum`，返回目标和对应的两个不同下标。 |
| 截止时间 | Mock 首次创建时间后 72 小时 |
| 大模型评估 | 关闭，使用规则评估 |
| 评分量规 | 功能正确性 45、鲁棒性 20、代码质量 20、算法效率 15 |

### 示例提交

提交者为张同学，内容如下：

```go
func twoSum(nums []int, target int) []int {
	seen := map[int]int{}
	for i, n := range nums {
		if j, ok := seen[target-n]; ok {
			return []int{j, i}
		}
		seen[n] = i
	}
	return nil
}
```

Mock 评估结果：

| 维度 | 得分 | 满分 | 主要证据 |
| --- | ---: | ---: | --- |
| 功能正确性 | 45 | 45 | 示例测试全部通过 |
| 鲁棒性 | 18 | 20 | 无解时安全返回 `nil` |
| 代码质量 | 16 | 20 | 职责明确，缺少函数注释 |
| 算法效率 | 13 | 15 | 使用哈希表一次遍历 |
| **总分** | **92** | **100** | 规则评估 |

## 5. 开关行为

- `seed.enabled: true`：在 AutoMigrate 后补充缺失的 Mock 用户、作业和提交。
- `seed.enabled: false`：只迁移表结构，不写入 Mock 数据。
- 作业的 `llm_evaluation_enabled: true`：学生提交时调用 `deepseek-v4-flash`。
- 作业的 `llm_evaluation_enabled: false`：学生提交时执行本地规则评估。
