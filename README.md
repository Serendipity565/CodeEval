# CodeEval AI

CodeEval 是面向编程课程的作业发布与自动评估项目。教师可以设置题目、评分量规和标准输入/输出测试；学生提交完整程序后，系统异步执行测试并生成反馈。教师可按作业启用 DeepSeek 评估，或使用本地规则评估。

当前仓库包含可运行的 Web、API、MySQL 和 Docker 沙箱，不是独立的论文复现项目。

## 功能与目录

| 目录 | 内容 |
| --- | --- |
| `web/` | React、TypeScript、Vite 前端；教师和学生界面 |
| `server/` | Go、Gin API；鉴权、作业、提交、评估队列与 MySQL 持久化 |
| `sandbox/` | Docker Runner 和 Go、Python、Java、C++ 执行镜像 |
| `docs/database.md` | 数据表、迁移和演示数据 |
| `design.md` | 界面设计规范 |

## 快速启动：Docker Compose

需要 Docker 和 Docker Compose。在本目录执行：

```bash
cp server/config.example.yaml server/config.yaml
```

启动前编辑 `server/config.yaml`：设置 `jwt.secret` 和 `sandbox.runner_token`；如需 AI 用例生成或 AI 评分，再填写 `deepseek.api_key`。同时修改 `docker-compose.yaml` 中的 MySQL 密码，并让 `database.password` 与 `MYSQL_PASSWORD` 一致。`server/config.yaml` 已被 Git 忽略。

```bash
docker compose up -d --build
docker compose ps
```

打开 `http://localhost:3000`，用页面注册教师或学生账号。后端健康检查是 `http://localhost:8080/healthz`。首次启动时 API 会通过 GORM `AutoMigrate` 创建数据库表；无须手工导入 SQL。

> 当前 Compose 示例把 3000、8080、8090 和 3306 端口绑定到宿主机所有网络接口。部署到服务器前，请按网络环境限制 API、Runner 和 MySQL 端口的访问；Runner 挂载 Docker socket，不能直接暴露给不可信客户端。

停止服务：

```bash
docker compose down
```

`docker compose down -v` 会删除 MySQL 数据卷，请仅在确定不需要数据时使用。

## 本地开发

需要 Go 1.23+、Node.js 20+、Docker Compose。先按上节创建配置文件；将 `server/config.yaml` 中的 `database.host` 改为 `127.0.0.1`，`sandbox.runner_url` 改为 `http://localhost:8090`。然后在不同终端运行：

```bash
docker compose up -d mysql sandbox-runner
make install
make dev
```

Vite 默认地址为 `http://localhost:5173`，并把 `/api` 代理到 `http://localhost:8080`。`make dev` 同时启动 Go API 和 Vite；也可分别运行 `make server-dev`、`make web-dev`。如果本地已有 MySQL，可自行提供与配置一致的数据库，不必启动 Compose 的 `mysql` 服务。

## 配置要点

所有后端运行配置放在 `server/config.yaml`；模板为 `server/config.example.yaml`。Compose 给 API 和 Runner 挂载同一份配置。修改配置后，重新创建相关容器使其生效。

| 配置 | 用途 |
| --- | --- |
| `database.*` | MySQL 地址、凭据和连接池；Compose 内主机名为 `mysql` |
| `jwt.secret` | 登录令牌签名密钥 |
| `seed.enabled` | 是否写入开发演示数据；模板默认为 `false` |
| `sandbox.enabled`、`runner_url`、`runner_token` | 沙箱开关、Runner 地址及内部鉴权 |
| `sandbox.supported_languages` | 教师可选的作业语言 |
| `sandbox.max_concurrent_sandboxes` | API Worker 并发数，目前允许 1 或 2 |
| `deepseek.*` | AI 用例生成及启用大模型评估的作业所用配置 |

不启用 AI 评分的作业使用本地规则评估；教师使用“AI 生成用例”或为作业启用大模型评估时，需要可用的 DeepSeek API Key。AI 生成的用例是可编辑草稿，教师保存后才用于提交测试。提交和评估任务在一个数据库事务中写入；Worker 从 MySQL 队列领取任务，状态可为 `queued`、`evaluating`、`graded` 或 `failed`。

## 提交与评分

支持 Go、Python、Java、C++ 的标准输入/标准输出程序。Go 代码需要 `package main` 和 `func main()`；Java 需要 `Main` 类及 `main` 方法；C++ 需要 `int main()`。请提交完整程序，不要只提交函数。

沙箱测试提供执行证据；有测试用例时，功能类评分项按测试权重计算。其余评分来自本地规则或教师启用的两阶段 DeepSeek 评估。隐藏用例的输入和期望输出不会通过学生作业接口返回。每份作业的提交次数上限由教师设置。

## 演示数据与检查

默认 `seed.enabled: false`，不会自动创建演示账号。开发时设置为 `true` 并重启 API 后，会补入 `teacher`、`student` 两个账号，密码均为 `CodeEval123!`，另有示例作业和提交。演示数据只适合本地环境，详情见 [数据库文档](docs/database.md)。

```bash
make server-test          # 后端测试
make sandbox-test         # 沙箱单元测试
make web-build            # TypeScript 检查与前端构建
make sandbox-docker-test  # 构建并测试四种语言执行镜像；需要 Docker
```

完整命令见 `make help`。
