# 健康健身教练 Plugin

## MCP metadata compatibility

This package declares its production Xunji connector as local stdio in `.mcp.json`. Codex skill MCP dependency metadata is documented for `streamable_http` URL servers; this local stdio connector does not add unsupported dependency fields to `agents/openai.yaml`.

本地 Codex Plugin：提供健康边界优先的训练、营养、恢复指导，并可通过 MCP 读取、分析、生成趋势面板、预览和按 ID 安全写回训记训练数据。

## 环境与安装

- 支持 **Windows**（Node.js 18.14.1+）和 **macOS**（Node.js 20+，安装凭证入口需要 Xcode Command Line Tools 的 Swift）。在 Node 18 上，依赖树使用已锁定的 `@hono/node-server` **1.19.17 override**。
- 从本Plugin根目录运行一键初始化脚本：

```powershell
.\scripts\setup-xunji.ps1
```

脚本会检查Node.js/npm版本、安装MCP运行时依赖，并调用凭据脚本。也可以手动执行：

```powershell
npm --prefix .\mcp\xunji ci --omit=dev --ignore-scripts
.\mcp\xunji\scripts\set-credential.ps1
```

只安装Skill不会自动注册本地Plugin。完成初始化后，在Codex的Plugins界面选择“添加本地插件”，目录选择当前`healthy-fitness-coach-plugin`目录；添加后刷新或重启Codex，并新建任务测试：`分析训记最近四周训练`。

## macOS 安装与连接

```sh
sh healthy-fitness-coach-plugin/scripts/setup-xunji-macos.sh
```

脚本安装锁定依赖并打开本机安全输入窗口。API Key 通过 Security.framework
写入登录钥匙串（service: `HealthyFitnessCoach.Xunji`，account: `xunji-api-key`），
不会放入命令参数、环境变量、stdout 或仓库。取消窗口不会修改已有凭证。
首次读取时 macOS 可能要求允许 `/usr/bin/security` 访问该条目。

只配置/更新凭证：

```sh
swift healthy-fitness-coach-plugin/mcp/xunji/scripts/keychain-credential.swift set
```

删除凭证（本机窗口确认，不删除缓存）：

```sh
swift healthy-fitness-coach-plugin/mcp/xunji/scripts/keychain-credential.swift remove
```

缓存、DNA 和写回日志位于 `~/Library/Application Support/HealthyFitnessCoach/`。
Windows 的 DPAPI 与 `%LOCALAPPDATA%` 路径保持不变。不支持的平台拒绝读取凭证，
不会回退到明文 Key。不要在聊天、截图、脚本参数或 Git 中提交 Key。

也可以直接注册 MCP（将路径替换为此仓库实际的绝对路径；node 使用绝对路径）：

```sh
codex mcp add xunji -- /absolute/path/to/node /absolute/path/to/repo/healthy-fitness-coach-plugin/mcp/xunji/src/server.js
```

新建聊天加载连接器。配置凭证后指定一个训练日期进行只读验证。
未通过真实账号读取验证前，不能称为已连接。写回仍需先预览并明确确认。

## 数据与隐私边界

- Windows 凭据和缓存保存在 `%LOCALAPPDATA%\HealthyFitnessCoach\`；Mac 凭据保存在钥匙串，缓存位置见上文；缓存按日期存储。
- MCP 提供按日/按范围读取、趋势分析、训练DNA提取、写回预览和显式确认写回；读取与DNA提取工具仍为**只读**，写回不是整天覆盖删除。
- 写回前先调用预览工具，确认所有记录属于同一天、最多 12 条且每条不超过 1500 字符；更新已有记录时保留 `id:`，有 `train_time:` 时原样带回。
- 成功写回后，以训记返回的最新 `res` 作为最终结果并更新当天缓存。
- 趋势工具返回本地自包含 HTML，可保存到工作区 `fitness-reports/`；不加载外部 CDN，也不上传用户数据。
- `xunji_extract_training_dna`会分别分析阻力和有氧训练，返回八维DNA、数据质量、证据台账和版本变更；DNA版本保存在`%LOCALAPPDATA%\HealthyFitnessCoach\training-dna\`，按账号单向fingerprint隔离。
- `xunji_get_training_trends`会在趋势数据旁返回`summary`和`guidance`：总结训练事实与数据质量，指导按“事实→判断→行动→验证”给出下一步，不会把稀疏数据包装成确定性结论。
- 标记为 Garmin 的记录会在面向模型的输出前被过滤；不会新增云数据库。
- 插件不会随源码或 `dist` 打包 `node_modules`、凭据、缓存、个人报告或真实训练数据。

## 删除本地数据

以下脚本先解析绝对路径并只允许删除 `HealthyFitnessCoach` 子目录；递归删除使用 PowerShell 确认语义。先使用 `-WhatIf` 预演，确认后去掉该参数：

```powershell
# 仅删加密凭据
.\mcp\xunji\scripts\remove-credential.ps1 -WhatIf

# 仅删日期缓存
.\mcp\xunji\scripts\remove-cache.ps1 -WhatIf

# 两者都删
.\mcp\xunji\scripts\remove-credential.ps1 -WhatIf
.\mcp\xunji\scripts\remove-cache.ps1 -WhatIf
```

## 已知依赖风险

Node 18 依赖树中仍存在已知的 Hono static-server advisory。该 Plugin 只启动 MCP stdio，绝不创建 Hono HTTP 或静态文件服务，因此该路径不暴露；这不是隐藏审计项。建议未来版本迁移到 Node 20，并在升级后重新审计依赖树。

## 连接与写回恢复

本地连接器支持 Windows、macOS 和 Linux/Docker，不提供手机远程服务。凭据通过本机受保护入口配置，禁止在聊天提交 Key。手机可使用独立 Skill 导入数据。

范围、趋势、DNA支持 `refresh_dates` 和 `refresh_all`。最近七天缓存满五分钟更新，90秒内不重复刷新。

写回现在必须先获得十分钟有效的 `preview_id`，确认内容后携带该ID提交。结果未知先用 `xunji_reconcile_training_upsert` 核对，不盲目重试。本地 `write-operations/` 保存提交摘要状态，服务重启仍阻止同批重发；不是服务端幂等保证。用户核对最新记录并确认未写入后才解除锁。服务端确认且本地缓存失败时依然返回 confirmed。

接续摘要由用户主动导入另一设备，没有自动云同步。

## 训练 Open API v2

生产连接器默认使用 `/api_trains_for_llm_v2` 和 `/api_upsert_trains_for_llm_v2`，
请求携带 `schema_version: train_open_api_v2`，从 `res.trains` 读取结构化记录，
兼容 gzip 和不含 `success` 的成功响应。不自动降级到旧生产接口。

- `xunji_get_training_day` 新增 `include_full_data`（默认 false）。
  RPE、未完成组、备注、实际休息和心率摘要等须用 true；原始结构保留在 `raw_v2`。
- 轻量、完整、旧版缓存使用不同目录。趋势仅统计明确完成的正式组；
  单位未知、超级组、递减子组暂不完整汇总并标记警告，原始数据仍保留。
- 写回工具 `records` 改为 v2 训练对象数组，最多 4 条同日训练，日期为今天前后
  六个日历月（边界包含）；每条最多 15 动作，每动作最多 20 组或轮。
- 保留 `localid/start/end`、全部动作、未完成组及 `note`；仅使用官方中文动作名，
  不传内部 key。RPE 使用字符串，原生有氧使用 `cardio: true` 和顶层 `metrics`。
- 写回继续绑定十分钟预览和明确确认；稳定摘要作为 `client_request_id`。
  空写回结果或结果未知均要求核对，不宣称写入成功，也不自动重发。
- 此适配只配置训练数据 Key；饮食、身体数据、个人模板需要各自授权，未启用。

验证范围：自动测试使用 mock；真实账号只读验证，不以真实写入测试功能。

## Linux / Docker：本地凭证文件

没有系统钥匙串的 Linux/无桌面容器使用本地文件保存**训练数据 API Key**。
训记 API 仍使用 Bearer 鉴权；本地 stdio MCP 不开放 HTTP 端口，无需另设 MCP
登录服务。饮食、身体数据、个人模板的独立 Key 不放进此文件。

凭证路径优先级：

1. `XUNJI_CREDENTIAL_FILE` 指定的绝对路径（变量只存路径，不存 Key）。
2. `$XDG_CONFIG_HOME/HealthyFitnessCoach/xunji-api-key`（XDG 路径必须绝对）。
3. `~/.config/HealthyFitnessCoach/xunji-api-key`。

格式为单行原始 Key，允许末尾换行；不用 JSON，不加 `Bearer ` 前缀。
文件必须属于运行 MCP 的用户，权限为 `0600` 或 `0400`。拒绝符号链接、目录、
组/其他用户可访问、可执行、空、多行或超过 16 KiB 的文件。不安全时返回
`missing_credentials`，不会回退到环境变量 Key 或匿名请求。
目录建议 `0700`，不要放在仓库；读取失败不输出路径或内容。

在可信 Linux 主机的 **Bash 交互终端**创建新凭证文件：

```bash
set +x
install -d -m 700 "$HOME/.config/HealthyFitnessCoach"
( umask 077
  set -o noclobber
  read -r -s -p 'Xunji training API Key: ' xunji_key
  printf '\n' >&2
  printf '%s' "$xunji_key" > "$HOME/.config/HealthyFitnessCoach/xunji-api-key"
  unset xunji_key
)
```

已有文件不会覆盖。缓存、DNA、写回日志位于 `$XDG_DATA_HOME/HealthyFitnessCoach/`，
未设置时为 `~/.local/share/HealthyFitnessCoach/`，仍按账号 fingerprint 隔离。

Linux 本机注册（替换实际路径）：

```sh
codex mcp add xunji --env XUNJI_CREDENTIAL_FILE=/absolute/path/xunji-api-key -- /absolute/path/node /absolute/path/repo/healthy-fitness-coach-plugin/mcp/xunji/src/server.js
```

### Docker 运行

从仓库根目录构建；镜像只复制代码和依赖，不复制凭证或个人数据：

```sh
docker build -f healthy-fitness-coach-plugin/Dockerfile -t healthy-fitness-xunji .
```

在 Linux Docker 主机只读挂载凭证，显式使用宿主 UID/GID，并挂载持久化数据目录：

```sh
install -d -m 700 "$HOME/.local/share/xunji-container"
docker run --rm -i --user "$(id -u):$(id -g)" \
  --mount "type=bind,src=$HOME/.config/HealthyFitnessCoach/xunji-api-key,dst=/run/secrets/xunji-api-key,readonly" \
  --mount "type=bind,src=$HOME/.local/share/xunji-container,dst=/data" \
  healthy-fitness-xunji
```

MCP 客户端配置相同的 `docker run --rm -i ...` 即可；不要加 `-t` 或发布端口。
持久化 `/data` 以保留未知写入提交锁。Docker secrets 可通过 `XUNJI_CREDENTIAL_FILE`
指定，但默认 `0444` 会被拒绝；容器内实际权限须为 `0400/0600` 且归属运行用户。
部分 Compose 本地 secrets 不支持 uid/mode，此时使用上面的受限文件挂载。
UID 映射以容器内看到的归属为准。先验证 initialize/tools-list 和授权日期读取，
不以真实写入测试。
