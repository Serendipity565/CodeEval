# 开发与配置

[文档首页](README.md) · [项目首页](../README.md)

本文中的配置路径和命令默认以项目根目录为基准。完整部署步骤见[快速启动](../README.md#快速启动docker-compose)。

## 本地开发

需要 Go 1.23+、Node.js 20+、Docker Compose。先按[项目首页](../README.md#快速启动docker-compose)创建配置文件；将 `server/config.yaml` 中的 `database.host` 改为 `127.0.0.1`，`sandbox.runner_url` 改为 `http://localhost:8090`。然后依次运行：

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
| `seed.enabled` | 是否补入演示账号、课程、选课和评分快照；模板默认为 `false` |
| `sandbox.enabled`、`runner_url`、`runner_token` | 沙箱开关、Runner 地址及内部鉴权 |
| `sandbox.supported_languages` | 教师可选的作业语言 |
| `sandbox.max_concurrent_sandboxes` | API Worker 并发数，目前允许 1 或 2 |
| `deepseek.*` | AI 用例生成及启用大模型评估的作业所用配置 |

不启用 AI 评分的作业使用本地规则评估；教师使用“AI 生成用例”或为作业启用大模型评估时，需要可用的 DeepSeek API Key。AI 生成的用例是可编辑草稿，教师保存后才用于提交测试。

## 体验演示数据

将 `server/config.yaml` 的 `seed.enabled` 设为 `true`，停止旧后端进程后重新运行 `make server-dev`；Compose 部署执行 `docker compose up -d --build server`。需要启动最新代码，单独刷新网页不会触发初始化。

初始教师账号为 `teacher`、`teacher02`，学生账号为 `student01` 至 `student08`；新建演示账号的统一密码为 `CodeEval123!`。已有同名账号的密码不会重置。全部账号、选课情况与推荐演示步骤见[演示数据](demo-data.md#演示账号与密码)。

重复启动只补缺失数据；如需恢复全新演示状态，按[清空并重新初始化演示库](demo-data.md#清空并重新初始化演示库)操作，先停止后端，再清空包含课程、选课关系的全部 9 张表。

## 检查与构建

```bash
make server-test          # 后端测试
make sandbox-test         # 沙箱单元测试
make web-build            # TypeScript 检查与前端构建
make sandbox-docker-test  # 构建并测试四种语言执行镜像；需要 Docker
```

完整命令见 `make help`。

代码查重的前端专项检查：

```bash
npm --prefix web run test:similarity
```

表结构见[数据库设计](database.md)，演示数据开关与账号见[演示数据](demo-data.md)。
