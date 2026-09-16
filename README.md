# CodeEval AI

面向编程课程的智能作业评估平台骨架。它不是论文复现，而是为下列能力预留了产品与服务边界：

- 教师创建作业、配置语言、测试用例与评分量规（rubric）
- 教师可按作业选择是否启用 DeepSeek Flash 大模型评估
- 学生提交代码并取得可追溯的自动评估结果
- 将确定性测试、静态分析、LLM 代码审查与教师复核组合成评分证据链
- 展示班级质量概览与学生的下一步学习建议

## 结构

```
sourcecode/
├── server/       # Go + Gin API，MySQL 持久化、JWT 鉴权与模拟评估器
└── web/          # React + Vite + TypeScript 管理端
```

## 本地运行

需要 Go 1.23+、Node 20+ 和 MySQL 8.0+。

在服务器上用 Docker Compose 启动 MySQL：

```bash
cd sourcecode
cp .env.example .env
# 编辑 .env，替换两个密码
docker compose up -d
docker compose ps
```

数据库数据保存在 Docker 命名卷 `mysql_data` 中。MySQL 直接映射服务器的 `3306` 端口，可供本地开发机连接；请自行通过防火墙和云安全组限制访问来源。

### 本地开发连接服务器 MySQL

MySQL 已直接公开 `3306` 端口。本地启动 Gin 前设置：

```bash
export CODEEVAL_DB_HOST='服务器 IP 或域名'
export CODEEVAL_DB_PORT=3306
export CODEEVAL_DB_NAME=codeeval
export CODEEVAL_DB_USERNAME=codeeval
export CODEEVAL_DB_PASSWORD='服务器 .env 中的 MYSQL_PASSWORD'
```

`CODEEVAL_DB_HOST`、`CODEEVAL_DB_PORT`、`CODEEVAL_DB_NAME`、`CODEEVAL_DB_USERNAME`、`CODEEVAL_DB_PASSWORD` 都会覆盖 `config.yaml`，便于为本地、测试和生产使用不同连接而不修改配置文件。

`config.yaml` 保存服务端口、允许跨域来源、MySQL 连接参数、JWT 有效期和本地示例账号开关。将 `database.username`、`database.name` 与 `.env` 中的 `MYSQL_USER`、`MYSQL_DATABASE` 保持一致。数据库密码与 JWT 密钥可分别由 `CODEEVAL_DB_PASSWORD`、`CODEEVAL_JWT_SECRET` 环境变量覆盖，避免把生产密钥写入文件。

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

DeepSeek 配置位于 `server/config.yaml` 的 `deepseek` 段，默认模型为 `deepseek-v4-flash`。填写 `api_key`。只有教师发布作业时勾选“启用大模型评估”，学生提交才会调用 DeepSeek。评估采用两阶段智能体：第一阶段结合教师知识库、参考实现和静态分析提取代码事实，第二阶段严格按量规评分并参考最近三次提交生成个性化建议。后端会弹性解析 JSON、定向修复不合格输出、校验维度和证据、重新计算总分，并保存置信度、证据类型和评估器版本。由于当前未执行代码，结果统一标记为未经执行验证。未勾选的作业只生成保守的待复核占位结果，不应作为正式成绩。

```bash
cd sourcecode/server
export CODEEVAL_DB_PASSWORD='与 ../.env 中 MYSQL_PASSWORD 相同的值'
export CODEEVAL_JWT_SECRET='替换为生产环境的长随机密钥'
export CODEEVAL_DEEPSEEK_API_KEY='你的 DeepSeek API Key'
go mod tidy && go run .

cd ../web && npm install && npm run dev
```

前端默认访问 `http://localhost:8080/api/v1`。可通过 `VITE_API_BASE_URL` 覆盖。

## 下一阶段接入点

`server/internal/evaluator` 是评估边界：将 `DemoEvaluator` 替换为队列任务即可接入隔离执行环境、AST/静态扫描和任意 LLM 提供商。生产环境不应直接执行用户提交的代码。

数据库表结构、关系和完整 Mock 数据见 [`docs/database.md`](docs/database.md)。

## 账号与权限

首次启动时，若 `seed.enabled: true`，会创建本地演示账号：

| 身份 | 账号 | 密码 | 可执行操作 |
| --- | --- | --- | --- |
| 教师 | `teacher` | `CodeEval123!` | 布置作业、查看全部提交与评估 |
| 学生 | `student` | `CodeEval123!` | 查看作业、提交代码、查看自己的评估 |

生产部署时请将 `seed.enabled` 改为 `false`，修改 JWT 密钥，并通过后台管理或迁移脚本创建真实账号。

所有开发用 Mock 数据集中在 `server/internal/store/mock_data.go`，目前包括教师、学生、示例作业和示例提交。初始化逻辑按稳定业务键查询后再插入，因此可以重复启动而不会重复造数据。
