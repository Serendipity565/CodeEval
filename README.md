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

## 部署方式

需要 Go 1.23+、Node 20+ 和 MySQL 8.0+。

先从模板创建唯一配置文件：

```bash
cp server/config.example.yaml server/config.yaml
```

连接地址完全由 `config.yaml` 控制：

- 后端在 Compose 中运行：`database.host: mysql`，`sandbox.runner_url: http://sandbox-runner:8090`。
- 后端在服务器宿主机运行：`database.host: 127.0.0.1`，`sandbox.runner_url: http://localhost:8090`。

### 完整项目容器化

```bash
docker compose up -d --build
docker compose ps -a
```

访问入口为 `http://服务器地址:3000`。Web 通过 Nginx 将同源 `/api` 请求转发给后端；后端、MySQL 和 Runner 端口只绑定服务器回环地址。

### 只部署 MySQL 和 Sandbox，后端在宿主机运行

按需要在 `docker-compose.yaml` 中注释掉完整的 `server:` 和 `web:` 服务段，然后执行：

```bash
docker compose up -d --build
docker compose ps -a
```

将 `config.yaml` 的连接地址改为宿主机方式，再启动后端：

```bash
cd server
go run .
```

MySQL 和 Runner 分别绑定 `127.0.0.1:3306`、`127.0.0.1:8090`。若还要在宿主机运行前端开发服务器，Vite 会自动将 `/api` 转发到 `localhost:8080`。

### 配置

项目不使用 `.env`。实际配置保存在被 Git 忽略的 `server/config.yaml`，可提交模板为 `server/config.example.yaml`。`docker-compose.yaml` 是部署示例；部署前请自行修改其中的 MySQL 初始化密码，并确保数据库名、账号和密码与 `config.yaml` 一致，同时修改 JWT 密钥和 Runner token。

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

DeepSeek 配置位于 `server/config.yaml` 的 `deepseek` 段，默认模型为 `deepseek-v4-flash`。填写 `api_key`。只有教师发布作业时勾选“启用大模型评估”，学生提交才会调用 DeepSeek。评估采用两阶段智能体：两个阶段都会直接读取作业说明、评分量规、课程知识库和参考实现；第一阶段结合静态分析提取代码事实，第二阶段综合教师上下文逐项评分，并参考最近三次提交生成个性化建议。发生材料冲突时以评分量规和作业说明为准，参考实现仅作为一种正确方案。评估结果只记录使用过的上下文类型，不返回参考实现或知识库原文。若教师配置了测试用例，沙箱执行证据会一并送入评分阶段，功能项最终得分由测试通过权重确定，模型不能覆盖。

评估任务先写入 MySQL 队列，再由固定数量的 Worker 领取。4C4G 服务器建议保持 `max_concurrent_sandboxes: 1`，确认内存和峰值负载充足后才提高到 2；其他提交会保持 `queued`。允许发布的语言由 `supported_languages` 统一控制，前端语言选项也从服务端读取：

```yaml
sandbox:
  enabled: true
  max_concurrent_sandboxes: 1
  supported_languages: [Go, Python, Java, C++]
  # 新提交会立即唤醒 Worker；这里只是异常恢复的兜底间隔。
  queue_poll_interval_ms: 30000
  job_timeout_seconds: 180
  max_attempts: 2
  runner_url: http://sandbox-runner:8090
  runner_token: codeeval-compose-internal
```

Docker Compose 会构建并启动独立 `sandbox-runner`，同时构建 Go、Python、Java、C++ 四个执行镜像。Runner 的 8090 端口只绑定宿主机 `127.0.0.1`；每次执行都使用一次性容器，并设置无网络、只读根文件系统、256MB 内存、0.75 CPU、64 PID、移除 Linux capabilities 和超时限制。Runner 与服务端各自限制并发，默认均为 1，其他提交进入 MySQL 队列。

Runner 为启动子容器需要挂载 Docker socket；它因此属于高权限基础设施，只应位于 Compose 内部网络。生产环境优先使用专用的 rootless Docker 主机或进一步将 Runner 拆到独立机器，不要给它映射公网端口。

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
