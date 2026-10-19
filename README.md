# CodeEval AI

CodeEval 是面向编程课程的作业发布与自动评估项目。教师可以设置题目、评分量规和标准输入/输出测试；学生提交完整程序后，系统异步执行测试并生成反馈。教师可按作业启用 DeepSeek 评估，或使用本地规则评估。

当前仓库包含可运行的 Web、API、MySQL 和 Docker 沙箱，不是独立的论文复现项目。

## 功能

- 教师发布作业，配置评分量规、参考实现和公开／隐藏测试。
- 学生提交完整程序，异步执行沙箱测试并查看评分依据与反馈。
- 支持 DeepSeek 两阶段评估、教师逐维度复核和独立专家评分对照。
- 教师可检测代码相似片段，查看对应行号并导出报告。

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

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `web/` | React、TypeScript、Vite 前端；教师和学生界面 |
| `server/` | Go、Gin API；鉴权、作业、提交、评估队列与 MySQL 持久化 |
| `sandbox/` | Docker Runner 和 Go、Python、Java、C++ 执行镜像 |
| [docs/](docs/README.md) | 开发配置、评估流程、数据库、演示数据和设计规范 |

## 文档

完整目录见 [文档首页](docs/README.md)。

| 需要做什么 | 阅读文档 |
| --- | --- |
| 本地开发、调整配置、运行检查 | [开发与配置](docs/development.md) |
| 了解评分、教师复核和专家对照 | [提交与评估](docs/evaluation.md) |
| 使用代码查重、了解算法与接口限制 | [代码查重](docs/code-similarity.md) |
| 查看表结构、持久化队列和人工评分接口 | [数据库设计](docs/database.md) |
| 导入演示账号、核对实际成绩、导出快照 | [演示数据](docs/demo-data.md) |
| 修改页面、组件、交互和视觉样式 | [界面设计规范](docs/design.md) |
