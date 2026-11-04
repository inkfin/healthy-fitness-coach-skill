# 训记训练数据：v2 读取、趋势与安全写回

## 连接

连接意图已表达时不重复询问。Windows 使用 DPAPI，macOS 使用登录钥匙串；
Mac 可运行 `swift <plugin>/mcp/xunji/scripts/keychain-credential.swift set` 打开安全窗口。
禁止在聊天、截图、日志、报告、源码或 Git 中回显 Key。读取已获用户明确授权的
本机文件凭证时，直接在内存中转存到钥匙串，不复制文件到仓库。
未配置时提供导入或先训练路径，不伪称已连接。

## 读取

- Base URL: `https://trains.xunjiapp.cn`。
- POST `/api_trains_for_llm_v2`，Bearer 训练数据 Key。
- JSON: `schema_version: "train_open_api_v2"`, `datestr: "YYYY-MM-DD"`,
  `include_full_data: false`。核心数据 `res.trains`；不要求 success 必须为 true。
- 需要 RPE、备注、未完成组、休息秒数、心率等时使用 `include_full_data: true`。
  没有心率字段不等于请求失败；接口不会提供原始心率数组。
- 返回保留 `localid/start/end` 和完整原始结构 `raw_v2`。日期缺失或无效时拒绝，
  不把请求日期强加给记录。Garmin 来源过滤后再交给模型。
- 只读取必要日期范围。普通/完整读取分别至少间隔 15/30 秒；限流按服务端提示等待。
  本地保留 90 秒刷新间隔；最近七天缓存满五分钟自动更新，更早日期默认读缓存。
  完整和轻量缓存隔离，`refresh_dates/refresh_all` 用于明确补录刷新。
- 成功空数组表示该日期无记录，失败不能描述为“没练”。

## 工具

- `xunji_get_training_day`: 一个日期；可传 `include_full_data`。
- `xunji_get_training_range`: 最小必要范围，返回成功/缺失日期、缓存来源。
- `xunji_get_training_trends`: 可追溯趋势和自包含 HTML。
- `xunji_extract_training_dna`: 先复盘 facts + decision，再提取有证据边界的 DNA。
- `xunji_preview_training_upsert`: 本地预览，返回十分钟有效 preview_id，不修改训记。
- `xunji_upsert_training_records`: 具体预览获明确确认后提交。
- `xunji_reconcile_training_upsert`: 未知结果先读服务器核对，不能盲目重试。

## 统计与报告

只把 `done: true` 的正式组纳入组次/训练量；热身和未完成组保留但不计入。
磅转换成 kg，未知单位不编造训练量。超级组和递减子组目前只保留原始数据并警告，
不得宣称这些记录的统计完整。训练记录可拆成动作行，不把动作行数当成训练场次。
报告说明日期范围、新鲜度、缺失日期和解析警告。HTML 不加载外部 CDN，不上传数据。
未经用户要求不要创建训练档案、修改计划或持久化报告；遵循仓库 AGENTS.md。

## 写回

POST `/api_upsert_trains_for_llm_v2`，JSON 包含 schema_version、稳定 client_request_id、
dry_run: false、include_full_data: true、res: [训练对象]。

1. 必须先预览并让用户确认具体变更。records 为 v2 对象数组，不能用旧文本行写生产接口。
2. 最多四条同日训练，日期为今天前后各六个日历月（含边界），每条最多十五动作，
   每动作最多二十组/轮。超级组按最大子动作数计入动作限额，不能嵌套。
3. 编辑前先完整读取原训练，保留 localid、start、end、其它动作、未完成组和 note 元数据。
4. 动作只用官方中文 name，名称不确定先查 `https://github.com/Foveluy/Xunji-movements`，
   不传内部 key。不要改动用户未要求的字段。
5. RPE 用 "6"～"10" 的半分字符串，清空用 ""；difficulty 为 easy/normal/hard。
6. 原生有氧用 cardio: true、不传 sets，指标放 movement.metrics；
   restTime/warn_restTime 为目标休息秒数，sets[].restSeconds 是实际休息。
7. 写回成功以服务端 res.trains 为准。空写回结果视为未知，先核对。
   未列出的旧训练不得删除；缓存保存失败不重发已确认写入。
8. 写回至少间隔 45 秒。结果 unknown/reconciliation_required 时禁止自动重试。
   用户核对并明确确认未写入后，使用限时 verification_id 解除本机锁，再新建预览。

凭证和训练数据只留本机，不提交 GitHub。这里只启用训练 Key；饮食、身体数据和
个人模板是独立凭证/接口，需要用户另行授权。官方计划接口暂未实现，不宣称支持。
