# CodeEval AI

面向编程课程的智能作业评估平台骨架。它不是论文复现，而是为下列能力预留了产品与服务边界：

- 教师创建作业、配置语言、测试用例与评分量规（rubric）
- 教师可让 AI 根据题目与参考实现生成输入/输出测试草稿，并在发布前逐项修改
- 教师可按作业选择是否启用 DeepSeek Flash 大模型评估
- 学生提交代码并取得可追溯的自动评估结果
- 将确定性测试、静态分析、LLM 代码审查与教师复核组合成评分证据链
- 展示班级质量概览与学生的下一步学习建议

## 结构

```
sourcecode/
├── server/       # Go + Gin API，MySQL 持久化、JWT 鉴权与模拟评估器
├── sandbox/      # Docker Runner、受限执行器与四种语言镜像
└── web/          # React + Vite + TypeScript 管理端
```

## 本地运行

需要 Go 1.23+、Node 20+ 和 MySQL 8.0+。

在服务器上用 Docker Compose 启动 MySQL：

```bash
cd sourcecode
docker compose up -d
docker compose ps
```

数据库数据保存在 Docker 命名卷 `mysql_data` 中。MySQL 直接映射服务器的 `3306` 端口，可供本地开发机连接；请自行通过防火墙和云安全组限制访问来源。

### 配置

项目不再使用 `.env`，本地开发和 Docker 部署统一读取被 Git 忽略的 `server/config.yaml`。`docker-compose.yaml` 只是部署示例；部署前请自行修改其中的 MySQL 初始化密码，并确保数据库名、账号和密码与 `config.yaml` 的 `database` 段一致，同时修改 JWT 密钥、`sandbox.runner_url` 和 Runner token。

服务启动时使用 GORM `AutoMigrate` 自动创建或增量更新 `users`、`assignment_records`、`submission_records` 表，不需要手工执行建表 SQL。

后端数据库连接流程位于 `server/internal/store/mysql.go`：读取 `server/config.yaml` 的 `database` 配置，组装 MySQL DSN，执行连接与 `PingContext`，设置连接池，最后运行 `AutoMigrate`。本地连接服务器数据库时，也可以直接把 `database.host` 写成服务器公网 IP：

```yaml
database:
  host: 你的服务器IP
  port: 3306
  name: codeeval
  username: codeeval
  password: 你的数据库密码
  charset: utf8mb4
  max_idle_conns: 5
  max_open_conns: 20
  conn_max_lifetime_minutes: 30
```

DeepSeek 配置位于 `server/config.yaml` 的 `deepseek` 段，默认模型为 `deepseek-v4-flash`。填写 `api_key`。只有教师发布作业时勾选“启用大模型评估”，学生提交才会调用 DeepSeek。评估采用两阶段智能体：第一阶段结合教师知识库、参考实现和静态分析提取代码事实，第二阶段严格按量规评分并参考最近三次提交生成个性化建议。若教师配置了测试用例，沙箱执行证据会一并送入评分阶段，功能项最终得分由测试通过权重确定，模型不能覆盖。

评估任务先写入 MySQL 队列，再由固定数量的 Worker 领取。4C4G 服务器建议保持 `max_concurrent_sandboxes: 1`，确认内存和峰值负载充足后才提高到 2；其他提交会保持 `queued`。允许发布的语言由 `supported_languages` 统一控制，前端语言选项也从服务端读取：

```yaml
sandbox:
  enabled: true
  max_concurrent_sandboxes: 1
  supported_languages: [Go, Python, Java, C++]
  queue_poll_interval_ms: 1000
  job_timeout_seconds: 180
  max_attempts: 2
  runner_url: http://sandbox-runner:8090
  runner_token: codeeval-compose-internal
```

Docker Compose 会构建并启动独立 `sandbox-runner`，同时构建 Go、Python、Java、C++ 四个执行镜像。Runner 不暴露宿主机端口，只接受服务端携带令牌的请求；每次执行都使用一次性容器，并设置无网络、只读根文件系统、256MB 内存、0.75 CPU、64 PID、移除 Linux capabilities 和超时限制。Runner 与服务端各自限制并发，默认均为 1，其他提交进入 MySQL 队列。

首次部署或修改沙箱镜像后执行：

```bash
docker compose up -d --build
docker compose ps
```

Runner 为启动子容器需要挂载 Docker socket；它因此属于高权限基础设施，只应位于 Compose 内部网络。生产环境优先使用专用的 rootless Docker 主机或进一步将 Runner 拆到独立机器，不要给它映射公网端口。

```bash
cd sourcecode/server
go mod tidy && go run .

cd ../web && npm install && npm run dev
```

前端默认访问 `http://localhost:8080/api/v1`；Docker 构建地址在 `docker-compose.yaml` 的 `VITE_API_BASE_URL` 构建参数中配置。

## 评分链路

提交会依次经过持久化队列、受限沙箱测试、静态分析和可选的两阶段 LLM 评估。教师端的“AI 生成用例”只生成可编辑草稿，教师确认并发布后才会成为正式测试；学生提交时，Agent 会同时读取学生代码、静态证据和沙箱测试结果。沙箱只支持完整的标准输入/标准输出程序：Go 和 C++ 源文件需包含 `main`，Java 主类必须名为 `Main`，Python 直接运行 `main.py`。

数据库表结构、关系和完整 Mock 数据见 [`docs/database.md`](docs/database.md)。

## 账号与权限

首次启动时，若 `seed.enabled: true`，会创建本地演示账号：

| 身份 | 账号 | 密码 | 可执行操作 |
| --- | --- | --- | --- |
| 教师 | `teacher` | `CodeEval123!` | 布置作业、查看全部提交与评估 |
| 学生 | `student` | `CodeEval123!` | 查看作业、提交代码、查看自己的评估 |

生产部署时请将 `seed.enabled` 改为 `false`，修改 JWT 密钥，并通过后台管理或迁移脚本创建真实账号。

所有开发用 Mock 数据集中在 `server/internal/store/mock_data.go`，目前包括教师、学生、示例作业和示例提交。初始化逻辑按稳定业务键查询后再插入，因此可以重复启动而不会重复造数据。
