# KnowFlick 局域网同步协议 v2（2026-10-03 定版）

> 跨端契约：macOS（Swift `SyncServer`/`SyncClient`/`CardExportEngine`/`CardImportEngine`）与 Android（Kotlin `SyncServer`/`SyncClient`/`CardJson`）逐字段对齐实现；未来 Windows 端照此文档对接，不得单端私改。
> v1 现状（本版之前）：`/api/cards` GET/POST 均为**裸卡片数组**，无版本字段、无墓碑、无编辑时间。v2 全部向后兼容（见「兼容规则」）。

## 1. 端点与鉴权（v1 不变）

- 端点：`GET /api/info`、`GET /api/cards`、`POST /api/cards`；鉴权头 `X-KnowFlick-Token`（6 位数字配对码）；请求体上限 25 MiB（超出回 413）。
- POST 响应：`{"status":"success","restored":n,"added":n,"ignored":n,"total":n}`，v2 增加可选 `"deleted":n`（本次被对端墓碑删除的本地卡数；旧端不认识则忽略）。
- 解析类失败回 400（v1.5 已引入）。

## 2. `/api/info`（v2 变更）

响应体在 v1 四字段（`deviceName` / `cardCount` / `favoriteCount` / `timestamp`）基础上**新增**：

```json
{"deviceName":"…","cardCount":123,"favoriteCount":4,"timestamp":1727900000000,"protocolVersion":2}
```

客户端行为：读取对端 `protocolVersion`——
- 缺字段（v1 旧端）→ UI 提示「对端版本较旧，建议两端升级后同步」**不阻断**（字段级兼容仍可同步，新字段会被旧端静默丢弃）；
- 值 ≤ 本端支持的最高版本 → 正常；
- 值 > 本端支持的最高版本 → 提示「对端版本更新」，**不阻断**。

## 3. `/api/cards` 载荷（v2 信封）

GET 响应体与 POST 请求体统一为**信封对象**：

```json
{"protocolVersion":2,"cards":[ …KnowledgeCard… ],"tombstones":[{"id":"uuid","deletedAt":1727900000000}]}
```

- `protocolVersion`：本载荷实际版本（当前恒 2）。
- `cards`：卡片数组，线格式与 v1 裸列表的单卡编码完全一致（双端既有 CardJson/Codable 不变）。
- `tombstones`：删除墓碑数组，可省略或为空数组。**本轮两端均无删除 UI，本地墓碑恒为空——本字段为协议预留**（Windows/未来版本提供删除功能时即用，不需要再改协议）。

### 兼容规则（解析端必须同时接受）

| 对端发来的载荷 | 判定 | 处理 |
|---|---|---|
| 顶层是 JSON 数组 | v1 裸列表 | 按 v1 解析，墓碑为空 |
| 顶层对象、有 `cards` | v2 信封 | 解析 `cards` + `tombstones`；`protocolVersion` 记录用于 UI 提示 |
| 其他 | 非法 | 400 |

发送端始终发本端支持的最高版本信封。

## 4. 墓碑合并语义（两端同源，测试逐条对齐）

每端本地持久化一张墓碑表（独立小文件，与卡片库同目录）：`[{id, deletedAt}]`，容量上限 **1000** 条，超出裁最老。

合并规则（对称，交换律成立）：
1. **收到墓碑** `{id, deletedAt}`：本地存在该 id 卡片，且卡片时间戳 ≤ `deletedAt` → 删除本地卡片、记入本地墓碑表（deletedAt 取较大者）；卡片时间戳 > `deletedAt`（对端删除后又有新编辑/重建）→ 保留卡片、忽略该墓碑。
2. **收到卡片**：本地墓碑表存在该 id 且 `deletedAt` ≥ 卡片时间戳 → 拒收（不复活）；否则正常合并，并清除本地同 id 墓碑（复活场景）。
3. 卡片时间戳取值：卡片有 `editedAt` 用 `editedAt`，否则用 `createdAt`。
4. POST 响应的 `"deleted":n` 计数仅统计规则 1 实际触发的本地删除。
5. **本地不存在的 id 收到墓碑**：同样记入本地墓碑表（`deletedAt` 取较大者）——防已删卡经第三方副本回流后再次灌入；复活仍由规则 2 的卡片时间戳判定兜底。
6. **合并产物的 `editedAt`**：取双方较新者（单方有则保留该值，双方皆无则 null）——保证墓碑判定的卡片时间戳随合并保持「最新编辑」口径，且两端确定性一致。

## 5. details 合并口径（v2 变更，修「用户缩短被旧长文覆盖」）

`KnowledgeCard` 新增**可选**字段 `editedAt`（epoch ms）：
- mac `CardEditorView` 保存编辑时写入 `editedAt = now`（headline/summary/details/category 任一变更都写）。
- 合并 details 冲突时：**双方均有 `editedAt` → 新者赢**；任一方缺失 → 沿用 v1 规则（取较长一方，兼容历史数据）。其余字段的合并规则不变（createdAt 较新者为主的字段级对称合并）。

## 6. 超时与重试（v2 统一）

- 连接超时 **6s**、读超时 **20s**（双端一致；Android 由 5s/15s 对齐过来）。
- 重试：3 次，退避 500ms×2^(n-1) + ≤100ms 抖动；挂起环境用协程 delay（Android 侧 `Thread.sleep` 改 `delay`，释放 IO 线程）。401/413/解析类错误不重试。

## 7. 双端标准夹具（测试逐字节共用）

两端测试必须包含以下夹具的解析断言（JSON 字符串逐字节相同）：

```
F1 v2 信封: {"protocolVersion":2,"cards":[{"id":"f1","headline":"测试卡","summary":"摘要","details":"正文","category":"冷知识","source":"seed","links":[],"createdAt":1727900000000,"seenAt":null,"swiped":null,"isFavorite":false}],"tombstones":[{"id":"dead","deletedAt":1727900001000}]}
F2 v1 裸列表: [{"id":"f1","headline":"测试卡","summary":"摘要","details":"正文","category":"冷知识","source":"seed","links":[],"createdAt":1727900000000,"seenAt":null,"swiped":null,"isFavorite":false}]
F3 墓碑抵抗: 卡片 createdAt=1727900000000 遇墓碑 deletedAt=1727900001000 → 拒收；createdAt=1727900002000 → 复活合并
F4 details 冲突: A{details:"短",editedAt:2000} × B{details:"更长的正文内容",editedAt:1000} → 取 A；B 无 editedAt → 取 B（旧规则）
```

（单卡编码以两端既有 KnowledgeCard 线格式为准，上例只示意字段子集；两端各自的既有测试套件是权威。）

## 8. 本地纵深（非协议，双端各自落地）

- mac 备份轮转扩为 3 代（cards.json → backup → backup.2）；`*.corrupt-*` 隔离副本上限 10 个，超出删最老。Android 备份对齐 2 代。
- 同步完成点（合并落库后、推送完成后）显式 flush 持久化队列，消除 kill-app 丢数窗口；mac 退出 flush 移后台 + 主线程有界等待（≤2s）。
- mac 同步面板加常驻明示文案：「关闭此面板即停止本机同步服务，对端进行中的同步会中断」。

## 9. 版本演进约定

- 加可选字段：不升版本号（decodeIfPresent 兜底）。
- 改字段语义/删字段/改结构：`protocolVersion` +1，两端同轮升级，旧版本按「缺字段给默认值」读。
- Windows 端实现以本文档 + 两端既有测试夹具为验收标准。
