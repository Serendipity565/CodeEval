# CodeEval AI

CodeEval 是面向编程课程的作业发布与自动评估项目。教师可以设置题目、评分量规和标准输入/输出测试；学生提交完整程序后，系统异步执行测试并生成反馈。教师可按作业启用 DeepSeek 评估，或使用本地规则评估。

当前仓库包含可运行的 Web、API、MySQL 和 Docker 沙箱，不是独立的论文复现项目。

本地检测服务已纳入同一个 `docker-compose.yaml`，统一通过 `server/config.yaml` 配置。
本地分类默认使用 NVIDIA CUDA（包括 RTX 4060 Laptop GPU），启动脚本按配置选择检测容器和 GPU；
运行前需让 Docker 能访问 NVIDIA 显卡。推理逐块执行，保留 CPU 配置选项。
Windows、16 GB 内存、RTX 4060 笔记本的目标配置与 WSL2 准备步骤见
[Windows GPU 部署](docs/docker-deployment.md#目标机器windows16-gb-内存rtx-4060)。
默认 Python、Java、C++、Go 使用本地 DroidDetect-Base-Binary，可用 `ai_detection.model: large` 切换 Large-Binary。
其他语言使用 DeepSeek；将 `ai_detection.provider` 改为
`ds` 即可全部切到 DeepSeek，无需修改前端或部署入口。见 [Docker 部署与迁移](docs/docker-deployment.md)。
已完成固定权重 CPU 加载与推理验证；Docker 构建和 NVIDIA GPU 运行仍需在目标环境验收。

## 功能

- 教师创建课程，在课程内发布作业，查看应提交人数、提交率和未提交名单。
- 学生通过“全部课程 / 已选课程”选课，查看并提交所选课程的作业。
- 教师配置评分量规、参考实现和公开／隐藏测试。
- 学生提交完整程序，异步执行沙箱测试并查看评分依据与反馈。
- 支持 DeepSeek 两阶段评估和教师逐维度复核。
- 教师可通过“代码检测”比对相似片段、导出报告，或复用 DeepSeek 识别 AI 生成倾向并查看代码依据。

## 快速启动：Docker Compose

需要 Docker、Docker Compose、Python 3 和 PyYAML。Windows 建议在 WSL2 中执行。
在本目录准备启动脚本依赖（不需要在宿主机安装 PyTorch）：

```bash
python3 -m venv .deploy-venv
source .deploy-venv/bin/activate
python3 -m pip install -r requirements-deploy.txt
```

以后打开新终端先激活这个虚拟环境。首次创建应用配置：

```bash
cp server/config.example.yaml server/config.yaml
```

启动前编辑 `server/config.yaml`：设置 `jwt.secret` 和 `sandbox.runner_token`；如需 DeepSeek 检测、AI 用例生成或 AI 评分，再填写 `deepseek.api_key`。同时修改 `docker-compose.yaml` 中的 MySQL 密码，并让 `database.password` 与 `MYSQL_PASSWORD` 一致。`server/config.yaml` 已被 Git 忽略。

```bash
python3 deploy.py up -d --build
python3 deploy.py ps
```

打开 `http://localhost:3000`，用页面注册教师或学生账号。后端健康检查是 `http://localhost:8080/healthz`。首次启动时 API 会通过 GORM `AutoMigrate` 创建数据库表；无须手工导入 SQL。

首次本地检测部署会自动下载所选模型的固定版本权重，`model-init` 成功退出后，检测服务及 API 才启动。
`ai_detection.model: base` 启动 `codeeval-droiddetect-base`；改为 `large` 启动 `codeeval-droiddetect-large`。
修改后再次执行 `python3 deploy.py up -d --build`，只保留所选检测容器。
切到 `provider: ds` 时不创建本地检测和初始化容器，并移除旧检测容器，释放显存。
两种权重分别缓存在 `detector_models` 命名卷，切回时复用；切换不重算历史报告。
启动脚本从应用 YAML 生成临时 Compose 配置；直接执行 `docker compose up` 不会应用容器选择和 CPU／DS 的 GPU 处理。

> 当前 Compose 示例把 3000、8080、8090 和 3306 端口绑定到宿主机所有网络接口。部署到服务器前，请按网络环境限制 API、Runner 和 MySQL 端口的访问；Runner 挂载 Docker socket，不能直接暴露给不可信客户端。

停止服务：

```bash
python3 deploy.py down
```

`python3 deploy.py down -v` 会删除 MySQL 和模型数据卷，请仅在确定不需要数据时使用。

## 演示账号

如需直接体验课程、选课与已有评分，在 `server/config.yaml` 中启用初始化，再启动或重新构建后端，无须逐个注册：

```yaml
seed:
  enabled: true
```

```bash
python3 deploy.py up -d --build server
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

逐个账号的姓名、选课情况、演示步骤，以及完整的十一表清空与重建示例，见[演示数据](docs/demo-data.md)。

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `web/` | React、TypeScript、Vite 前端；教师和学生界面 |
| `server/` | Go、Gin API；鉴权、作业、提交、评估队列与 MySQL 持久化 |
| `sandbox/` | Docker Runner 和 Go、Python、Java、C++ 执行镜像 |
| `detector/` | DroidDetect Base/Large Binary CUDA/CPU HTTP 服务、固定版本权重初始化及模型来源说明 |
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
