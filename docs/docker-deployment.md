# Docker 部署与迁移

[项目首页](../README.md) · [代码检测](code-similarity.md)

只使用项目根目录的 `docker-compose.yaml` 和 `server/config.yaml`。
部署入口保持统一，镜像按容器的原生架构构建。
当前 Compose 给检测服务开放一张 NVIDIA GPU，本地分类器默认使用 CUDA 计算。
CPU 模式仍在同一份配置中保留；不要求在宿主机安装 Python 或完整 CUDA 开发工具包。
已在隔离环境验证固定版本权重的 CPU 加载与推理，并运行相关回归测试。当前主机没有 Docker / NVIDIA GPU，容器构建与 CUDA 推理留待目标环境验收。

## GPU 环境准备

### 目标机器：Windows、16 GB 内存、RTX 4060

这里的 16 GB 按系统内存理解，显卡可用显存以实际机器为准。
使用 Docker Desktop 的 Linux 容器与 WSL2 后端，并让 Docker 能访问 NVIDIA GPU。
无需在 Windows 宿主机安装 Python、PyTorch 或完整 CUDA Toolkit；检测依赖在镜像内安装。

当前配置保持：

- `ai_detection.provider: auto`：Python、Java、C++、Go 均使用 DroidDetect-Base-Binary。
- `ai_detection.device: cuda`：明确要求 GPU，不可用时报告错误。
- 单个共享模型、float32、每次一份提交、每次一个最多 512 词元的窗口。
- 检测容器最多使用 4 个 CPU 核心和 6 GB 系统内存；这是上限，不是预分配。
- 一张 NVIDIA GPU；不配置并行批量推理，不要求运行 Large 版本。

16 GB 系统内存还需要供 Windows、WSL2、MySQL 和代码沙箱使用，
不要把全部内存分配给 WSL2 或提高检测并发。当前设置是部署起点，
实际显存、耗时及容器启动情况在目标笔记本验收。
首次下载模型需要联网，完成后检测推理在本机运行，不上传学生源码。

RTX 4060 Laptop GPU 使用标准 NVIDIA CUDA 路径，无需笔记本专用权重或单独部署文件。
当前镜像在 x86_64 安装 PyTorch 2.6.0 的 CUDA 12.4 版本；Compose 使用 NVIDIA 设备声明开放一张显卡。
Windows 笔记本需更新 NVIDIA Windows 驱动和 WSL2，并启用 Docker Desktop 的 WSL2 Linux 容器后端。
GPU 必须先能被 Docker 访问，应用内的设备选择才能生效。

部署依据：[Docker GPU 支持](https://docs.docker.com/desktop/features/gpu/)、
[Compose GPU 声明](https://docs.docker.com/compose/how-tos/gpu-support/)、
[PyTorch 2.6 CUDA 安装版本](https://docs.pytorch.org/get-started/previous-versions/)。

默认逐份请求、逐个片段推理，窗口不超过 512 个词元，保持 float32；不扩大批次或开启半精度。
这是针对笔记本显存预算的初始设置，尚未测量实际峰值显存与速度。

## 启动

首次部署，先创建现有的应用配置文件；已有配置时保留原文件，不覆盖密钥：

```bash
cp server/config.example.yaml server/config.yaml
```

按项目首页设置 JWT 密钥、沙箱令牌和数据库连接。
启用 DeepSeek 的功能时填写 `deepseek.api_key`，不需要额外的配置文件或检测令牌。

```bash
docker compose up -d --build
docker compose ps -a
docker compose logs -f model-init droiddetect server
```

打开 [http://localhost:3000](http://localhost:3000)。
第一次会构建依赖并下载固定版本的 DroidDetect-Base-Binary 权重（约 600 MB），需要能访问镜像仓库、包源及 Hugging Face。
`model-init` 显示 `Exited (0)` 是正常完成；后端等待检测服务健康后启动。
完整且版本匹配的模型卷会被复用，后续启动跳过下载。模型下载失败时查看初始化日志，再次启动即可续用已完成文件。

已有部署从 LLMSniffer 切换时，重建并清理旧服务容器（保留数据库和模型卷）：

```bash
docker compose up -d --build --remove-orphans
```

新初始化器根据 manifest 下载新权重，不复用旧分类器；旧权重文件可保留，不影响加载。
旧配置的 `provider: llmsniffer` 以及默认 `http://llmsniffer:8010` 地址会兼容映射到 DroidDetect。
历史报告保留原版本和结果，点击“重新生成”才会使用 DroidDetect。

已有部署更新 CUDA 版本时，同样执行 `docker compose up -d --build`，需要重新构建检测镜像，
仅重启旧容器不会把 CPU 版 PyTorch 换成 CUDA 版。已有模型权重卷继续复用。

业务数据和模型分别保存到 `mysql_data`、`detector_models` 命名卷。
停止用 `docker compose down`；`down -v` 会删除这两类持久数据。
源码目录名称影响 Compose 默认项目名，迁移时保留相同目录名；若需更改项目名，先按下文迁移数据。

## 切换底层检测实现

修改 `server/config.yaml` 的 **一个选择项**：

```yaml
ai_detection:
  provider: auto
  url: http://droiddetect:8010
  timeout_seconds: 180
  device: cuda
  cpu_threads: 4
```

| provider | 检测行为 |
| --- | --- |
| `auto`（默认） | Python、Java、C++、Go 使用本地分类器，其他语言使用 DeepSeek |
| `droiddetect` | 只用本地分类器，其他语言明确显示不可用 |
| `deepseek` 或 `ds` | 全部使用 DeepSeek，跳过本地模型下载和加载 |

计算设备由同一 YAML 中的 `device` 选择：

| device | 行为 |
| --- | --- |
| `cuda`（默认） | 要求可用的 NVIDIA CUDA GPU；不可用时启动失败，不静默改为 CPU |
| `cpu` | 模型与输入只在 CPU 计算 |
| `auto` | 容器内部能使用 CUDA 时选 CUDA，否则选 CPU |

`auto` 只影响容器内的选择，不能解决 Docker 宿主机的 GPU 透传问题。
若迁移到没有 NVIDIA GPU 的主机，在同一 `docker-compose.yaml` 中删除
`droiddetect.deploy.resources.reservations.devices` GPU 声明，并把 `device` 设为 `cpu`。
DS-only 的无 GPU 部署也需移除该声明，因为 Docker 在应用读取 provider 之前就会请求 GPU。
保留同一部署文件，不添加系统专用入口或额外配置文件。

例如以后全部切换 DS，只改为：

```yaml
ai_detection:
  provider: ds
```

未填写的 URL、超时、设备和线程数都有默认值。DS 连接复用原有配置：

```yaml
deepseek:
  base_url: https://api.deepseek.com
  api_key: 填写已有的密钥
  model: deepseek-v4-flash
  timeout_seconds: 60
  max_tokens: 4096
  max_code_bytes: 100000
```

保留其余应用配置。切换后执行：

```bash
docker compose run --rm model-init
docker compose up -d --force-recreate droiddetect server
```

第一条在本地检测模式准备或复用权重，在 DS 模式直接跳过；第二条让两项服务读取新配置。
DS 模式的本地 HTTP 容器保持轻量待机，健康检查返回 `disabled`，不导入 PyTorch、不加载权重，
也不会承接分类任务。安装依赖的镜像仍保留，便于以后切回，不需要删除模型卷。

切换不修改历史报告、不自动重算；需要新方法的结果时由教师显式点击“重新生成”。
AI 评分、生成测试用例等功能仍按原 DeepSeek 配置运行，不受检测 provider 选择影响。

## 底层封装与报告

`server/internal/evaluator/detection_provider.go` 定义统一 `AIDetectionProvider`：

- `Supports` 声明语言范围；`Options` 声明可用性、是否需要样本与历史材料。
- `Detect` 接收相同的作业、代码与材料，返回相同的报告结构。
- 本地和 DeepSeek 各自实现，路由集中在工厂；API 和前端不判断具体模型实现。
- 后续增加实现只需新增适配器并登记路由，无须另建一套提交、保存或导出接口。

API 与检测服务读取同一 YAML，从 `jwt.secret` 使用固定域分隔的 HMAC 自动派生内部鉴权令牌。
修改 JWT 密钥时同时重启 API 和检测服务。内部检测端口不映射到宿主机。

本地输入保留原始注释、文档字符串和空白，不沿用旧模型的注释删除逻辑。
本地分类报告独立保存分块、词元覆盖、模型版本与预处理版本，不伪造五维度解释。
每窗口最多 512 个模型词元，重叠 64 个内容词元，按新增覆盖词元加权。
超过 100000 字节或 64 块会明确失败，不截断后冒充完整分析。
代码分类分数不是 AI 编写行数比例或校准概率，行范围只是分析区域。
本地分类不使用题面、公共框架排除、测试结果和提交历史，课程样本的检测效果仍需独立评估。
不同 provider 的分数保留各自方法说明，不能直接混合平均。
固定权重来源见 [模型来源](../detector/THIRD_PARTY.md)。

## 迁移现有作业与报告

源码压缩包不包含配置密钥、数据库或模型权重。迁移时单独保留
`server/config.yaml`，并使用 SQL 备份迁移已有数据；直接复制源码不会复制 Docker 命名卷。

在旧部署目录暂停写入并导出：

```bash
mkdir -p backups
docker compose stop web server
docker compose exec -T mysql sh -c 'exec mysqldump -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --single-transaction --no-tablespaces --set-gtid-purged=OFF "$MYSQL_DATABASE"' > backups/codeeval.sql
```

确认转储成功后，把源码、配置和 SQL 备份复制到目标部署目录。
若仍需使用旧环境，执行 `docker compose up -d server web`。

目标机先设 `seed.enabled: false`，导入时不启动 API。以下用于目标机新建的空数据库；
若已有数据，应先备份，再决定如何合并：

```bash
docker compose up -d mysql
docker compose ps
# 等数据库 healthy 后导入
docker compose exec -T mysql sh -c 'exec mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < backups/codeeval.sql
docker compose up -d --build
```

首次本地部署自动重新下载模型。需要搬运已有模型缓存时，应单独导出
`detector_models` 卷并保留文件权限；迁移的是权重文件，不是旧主机的 Python 环境。
使用 DS 时不需要模型缓存。

## 部署后的验收

下列检查本次未执行，留给目标部署环境：

```bash
docker compose ps -a
docker compose logs --tail=100 model-init droiddetect server
docker compose exec -T droiddetect python -m unittest test_preprocessing test_settings test_runtime -v
```

固定版本模型准备好后，可在目标笔记本运行完整检测服务回归，包含实际权重、
原始输入的直接推理对照、四种语言、中文注释行号、长代码覆盖与超限失败检查：

```bash
docker compose exec -T -e CODEEVAL_TEST_MODEL_DIR=/models droiddetect python -m unittest discover -v
```

CUDA 模式下检查实际设备（在目标机器运行）：

```bash
docker compose exec -T droiddetect python -c "import torch; print('CUDA build:', torch.version.cuda); print('GPU visible:', torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'No CUDA GPU')"
docker compose exec -T droiddetect python -c "import json,urllib.request; print(json.loads(urllib.request.urlopen('http://localhost:8010/healthz').read()))"
```

应同时看到 `GPU visible: True`、实际的 RTX 4060 Laptop GPU 名称，以及服务健康响应
`device: cuda:0`。健康响应还记录 float32 精度及总显存；保存报告的 JSON 中包含实际设备信息。
后端在明确要求 CUDA 时拒绝接收 CPU 运行报告，避免误用旧 CPU 镜像。
DS 模式健康响应为 `disabled` / `device: none`，表示没有加载本地模型。

启动失败时先检查 Docker 的 NVIDIA GPU 支持和驱动版本；显存不足时明确报错，不返回占位分。
在目标机对比少量 CPU/GPU 同输入结果与耗时；不能假定两种设备逐位相同，也不能把加速等同于识别率提升。

验证 Python、Java、C++、Go 的完整分块、无同题样本步骤、保存读取及 HTML 导出；
切到 `ds` 后四种语言均走 DeepSeek 上下文分析。
另外验证四种语言的沙箱执行，以及 DS 密钥缺失、模型不可达、超时或超出处理上限时的错误展示。
开发回归命令见 [开发文档](development.md#检查与构建)。
