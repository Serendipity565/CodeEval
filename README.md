# CodeEval AI

CodeEval 是面向编程课程的作业发布与自动评估项目。教师可以设置题目、评分量规和标准输入/输出测试；学生提交完整程序后，系统异步执行测试并生成反馈。教师可按作业启用 DeepSeek 评估，或使用本地规则评估。

当前仓库包含可运行的 Web、API、MySQL 和 Docker 沙箱，不是独立的论文复现项目。

## 功能

- 教师创建课程，在课程内发布作业，查看应提交人数、提交率和未提交名单。
- 学生通过“全部课程 / 已选课程”选课，查看并提交所选课程的作业。
- 教师配置评分量规、参考实现和公开／隐藏测试。
- 学生提交完整程序，异步执行沙箱测试并查看评分依据与反馈。
- 支持 DeepSeek 两阶段评估和教师逐维度复核。
- 教师可通过“代码检测”比对相似片段、导出报告，或复用 DeepSeek 识别 AI 生成倾向并查看代码依据。

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

## 演示账号

如需直接体验课程、选课与已有评分，在 `server/config.yaml` 中启用初始化，再启动或重新构建后端，无须逐个注册：

```yaml
seed:
  enabled: true
```

```bash
docker compose up -d --build server
```

新建演示账号的统一密码为 **`CodeEval123!`**（末尾为英文感叹号）。已有同名账号的密码不会被重置。

旧版教师账号 `teacher` 会在启用 seed 后升级为 `teacher01`，保留原密码与课程关系；若新账号名已被占用，初始化会报错，不自动合并账号。

| 账号 | 身份 | 推荐体验 |
| --- | --- | --- |
| `teacher01` | 李老师，教师 | 管理 C++ 程序设计、数据结构与算法；查看选课名单与提交率 |
| `teacher02` | 周老师，教师 | 管理 Python 程序设计；体验空名单与发布首项作业 |
| `student01`–`student06` | 学生，已有真实评分 | 查看两数之和作业的代码、测试结果与评分反馈 |
| `student07`、`student08` | 学生，初始未提交 | 进入已选课程完成作业；可在教师端核对未提交名单 |

全新初始化包含 3 门课程、2 位教师、8 名学生、11 条选课关系和 6 份已评分提交，原作业提交率为 75%。升级已有数据库时，原作业所在课程可能显示为“编程实践”，课程归属和已有数据会保留。

逐个账号的姓名、选课情况、演示步骤，以及完整的九表清空与重建示例，见[演示数据](docs/demo-data.md)。

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
| 了解评分与教师复核 | [提交与评估](docs/evaluation.md) |
| 使用相似度比对与 AI 生成识别、了解算法与接口限制 | [代码检测](docs/code-similarity.md) |
| 查看表结构、持久化队列和人工评分接口 | [数据库设计](docs/database.md) |
| 查看演示账号密码、选课关系、重置演示库、核对实际成绩 | [演示数据](docs/demo-data.md) |
| 修改页面、组件、交互和视觉样式 | [界面设计规范](docs/design.md) |
