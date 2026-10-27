# 验证与复现记录

日期：2026-10-25（Asia/Shanghai）。机器：macOS。本文件只记录本轮实际观察和执行，不把既有文档中的勾号当成本轮结果。

## 1. 基线和运行隔离

检查开始：HEAD `65e11184bf3de86298d2df04ea164bb387dd8e4a`，加上 5 个已有工作区文件。检查过程中，另一会话将这 5 个文件按原内容提交为 `9e8331c323d0695d8e96c4f50b03f0932729f86e`。本轮没有提交或修改这些实现。两版差异就是笔记本/标签及其回归和说明，已被本轮复现覆盖。

检查期间先前的 Vite 服务退出：本轮服务进程返回退出码 143；此前可连接的 1420/1435 随后均无监听。具体退出原因未独立确认，不能据此推断产品发生崩溃。为重验浏览器套件，另取 `9e8331c` 的源码快照，在 `.scratch/project-audit-2026-10-25/snapshot` 下启动独立服务；快照不受原工作区反向验证临时改写和 HMR 干扰。

运行时：Python `3.15.0`、JDK `17.0.20.1`、Node `26.7.0`、Vite `6.4.4`、Vitest `3.2.7`。CI 配置使用 Node 22，因此本机通过不能代替 Node 22 验证。

临时日志/包/探针在 `.scratch/project-audit-2026-10-25/`，**不会进入 Git**。跨机器需要保留的观测已写入本文件及 [observations.json](observations.json)。所有复现笔记与文本均为本轮合成数据；没有对用户真实桌面库做故障注入。

## 2. 实际验证结果

### Workbench 编译、逻辑与守卫

执行 `./tools/verify_workbench.sh`，其中编译/逻辑阶段得到：

```text
Vitest: Test Files 72 passed; Tests 447 passed
Rust:   111 passed; 0 failed; 3 ignored
Rust proxy http tests: 13 passed; 101 filtered out
MCP smoke: 8 checks passed
MCP independent temporary database: 20 assertions passed
MCP reverse tests: 6 cases rejected their defective implementation
```

类型检查通过。门禁中的 Python 规则测试、Tauri 70 条命令/声明/权限核对、错误/来源/删除确认/空断言守卫通过；删除确认反向验证 4 项通过。单独执行 `python3 -m unittest discover -s tools`：**91 tests，OK**。分类与剪藏跨端检查通过；退役 seed_cards 缺失按脚本设计跳过，不代表漏执行新笔记检查。

另执行 `cd apps/workbench && npm run build`：成功，生产构建 107 个模块；主 JS 479.12 kB（gzip 160.91 kB）。这是构建输出，不是首启、内存或键入性能成绩。

静态文档守卫报告“前端声明 451、Rust 声明 114、14 套浏览器冒烟、53 条证据标识”。**实际执行结果仍用上面的 447 与 111+3。** 声明数与运行数是不同口径，本轮未把差额直接判断成丢测。

### 浏览器门禁

首轮整套门禁没有通过：`workspace_ui_smoke` 在 `fill input[aria-label="统一分类名称"]` 时被子进程 20s 超时终止；最后的 `desktop_interaction_smoke` 又出现 `ERR_CONNECTION_REFUSED`。真机外部写入项因 App 未运行而跳过。原始浏览器入口依赖当时正在运行的 1420 服务。

因此不能报告“verify 全绿”，也不能仅凭一次 timeout 就认定批量分类功能有稳定缺陷。环境中存在并发会话、编译负载和测试服务退出；本报告未作未经验证的单一归因。

第二次针对 1435 的重跑发现服务也已退出，运行器返回 SKIP/0，**这一轮不计通过**。随后改用固定 `9e8331c` 源码快照再运行 14 套浏览器回归；最终结果登记在本文件末尾的“收尾结果”。桌面专有外部写入套件需要运行中的真实 App，本轮相关条件缺失时只记 SKIP。

本轮独立探索使用 Ego Lite 的测试空间，实际完成笔记编辑、自动保存、冲突、下载备份与仓储写回。空间在采集后关闭，没有留置测试标签。工具提示更新，本轮没有升级。

### Kotlin / Android

执行：

```sh
cd apps/android
./gradlew :domain:jvmTest :shared-data:jvmTest :shared-ui:jvmTest :desktop:test
```

结果 `BUILD SUCCESSFUL`，24 个任务均为 up-to-date。已有 XML 结果汇总：domain 227、shared-data 43、shared-ui 10、desktop 20，共 **300** 项，failure/error/skipped 都为 0。**这是复用缓存结果，不能声称本轮重新执行了 300 个用例。**

进一步执行 `./tools/build_android.sh`：Debug 单测与 Lint 成功，Release 装配成功，APK v2 签名与对齐校验通过；产物为 `dist/android/KnowFlick-0.10.3.apk`，没有上传或发版。App 的 Debug 单测 XML 为 **98 项，0 失败**；本轮该任务实际执行。共享模块仍有缓存复用。

编译有已有弃用/opt-in 警告，没有在审查中顺手改动。未执行 Android 真机/模拟器 UI、物理麦克风或平板笔迹验收。

### 旧 JSON MCP

`node --test tools/knowflick-mcp/test.mjs`：**24 passed、0 failed、0 skipped**。它验证旧 JSON/暂存链路，不代表 SQLite MCP 已具备项目授权，也不代表新 Note 能从外部被检索。

### 远端 CI

读取 [PR #95](https://github.com/bitterSmilezzz/knowflick/pull/95) 和对应 Actions。针对 `65e1118`：

- [Workbench 门禁与浏览器](https://github.com/bitterSmilezzz/knowflick/actions/runs/40110286968) 成功。
- [Workbench 三平台构建](https://github.com/bitterSmilezzz/knowflick/actions/runs/40110287018) 的 Linux/Windows/macOS 成功；附 Release 的 job 因非发布场景跳过。
- [Android](https://github.com/bitterSmilezzz/knowflick/actions/runs/40110287062) 成功。
- [冻结 JVM desktop 三平台](https://github.com/bitterSmilezzz/knowflick/actions/runs/40110287038) 构建成功。

这些记录由 `gh` 在本轮读取，针对明确 SHA。检查中产生的 `9e8331c` 不自动继承旧 SHA 的成功结果；本轮没有把后续新提交的远端状态虚填为通过。

## 3. 关键复现

### E01 / KF-001：不打开笔记页就导出

1. 在独立测试浏览器和独立端口中创建一篇笔记，等到“已保存”。
2. 刷新应用，停留默认收件箱，**不要点全部笔记**。
3. 点击顶栏“导出备份”，保存实际下载的 .kfbackup。
4. 比较仓储和 ZIP 内容。

实际：浏览器 key 中 `notes.length=1`；下载包 manifest 的 notes=0，notes.json 为 `[]`；同时出现“已导出完整备份包”。已检查的包名为 `without-opening-notes.kfbackup`（临时产物，不提交）。

本轮用 Python 标准 ZIP 库直接读取下载字节，未依赖产品自己的解包器来证明其正确：

```python
import json, zipfile
with zipfile.ZipFile("样本.kfbackup") as z:
    print(json.loads(z.read("manifest.json"))["stats"])
    print(json.loads(z.read("notes.json")))
```

### E02 / KF-004：属性被正文自动保存覆盖

1. 新建“审查样本 A”，正文“初始正文”，等保存。
2. 将笔记本设为“项目甲”，等待筛选项出现并读到 notebook 已落库。
3. 改正文为“初始正文，新增一段内容”，等自动保存。

实际关键字段：

```json
{
  "before": {"currentRevision": 1, "notebook": "项目甲", "bodyMd": "初始正文"},
  "after": {"currentRevision": 2, "notebook": null, "bodyMd": "初始正文，新增一段内容"}
}
```

没有切库、重置存储或调用删除。后续 agent 应在这一点加断言；当前新增冒烟只检查“设属性后已存”，没有继续写正文。

### E03 / KF-002：冲突后自动取得覆盖资格

1. 在 UI 保存“并发审查样本”，正文“版本一”。
2. UI 输入“本地旧草稿”，在其自动保存前，通过当前仓储接口写入“外部窗口的新内容”。这是合成的另一写入者，不使用真实外部进程或私人库。
3. 等到 UI 冲突态，确认仓储正文仍是外部新内容、修订 2。
4. UI 继续输入成“本地旧草稿继续写”。

实际：第 3 步 draft=本地旧草稿、stored=外部窗口的新内容/revision 2；第 4 步界面回到 saved，stored 变为本地旧草稿继续写/revision 3。期间没有用户选择覆盖或合并。

### E04 / KF-003：真实恢复操作后的字段变化

使用完整的 Note 样本，关键值为 revision 9、createdAt 1000、updatedAt 2000、isDeleted true、deletedAt 3000。通过产品当前 `createKfBackupArchive → restoreKfBackup → restoreNotesBundle → readNotes` 实际执行，目标是本轮测试 origin 的空 id 槽位。

实际：正文/普通属性保留，但 revision=1、created/updated=恢复时刻、isDeleted=false、deletedAt=null。**不是只调用包解析器观察结果。**

另将当前 `db.rs`、`notes.rs` 作为源码模块装入临时 Rust 探针，使用内存 SQLite，不调用用户默认库。rusqlite/serde/serde_json/sha2 的解析版本与主 Cargo.lock 一致，分别为 0.32.1/1.0.229/1.0.154/0.10.9。

原生调用：`note_upsert(&conn, &note, 0, 4000)`，读回：

```json
{"currentRevision":1,"createdAt":4000,"updatedAt":4000,"isDeleted":false,"deletedAt":null}
```

这证明恢复复用普通编辑操作不符合恢复契约；不证明本轮走过完整 macOS 恢复对话框。

### E05 / KF-005：回收站查询语义

在同一内存 SQLite 创建并软删一篇笔记，再调用当前函数：

```text
note_list(conn, false, 10000).len() = 0
note_list(conn, true, 10000).len()  = 1
```

结合 `readNotes → noteList(false)` 和 UI 对该结果过滤 isDeleted 的代码路径，确认桌面仓储缺少回收站数据。浏览器 UI 的删除恢复通过不能反驳这一适配器缺陷；完整原生 UI 路径交由 T02/T12 补验。

### E06 / KF-006：同名库、不同 id

本地创建 `audit-local-kb / 同名审查库`；备份携带 `audit-backup-kb / 同名审查库` 以及后者到测试笔记的成员关系。调用实际 `restoreNotesBundle`。

```json
{"reportedCount":2,"knowledgeBaseIds":["audit-local-kb"],"membership":{}}
```

恢复跳过了同名库的建立，却没有将成员映射到本地 id；错误被吞掉。原始合成数据与实际结果见 observations.json。

### E07 / KF-009：声明校验和未被执行

1. 用当前打包器创建含 notes.json 的包。
2. 修改 notes.json 中正文为“被篡改的正文”，保留原 manifest/checksum，用产品 ZIP 写入器重新生成合法容器。
3. 调用当前 `restoreKfBackup`。

实际：accepted=true、读出被修改正文，没有校验错误。该试验证明**完整性检查未执行**，不表示任何普通校验和可以验证恶意发包者身份。

### E08 / KF-011：正文改完没有索引失效

在内存 SQLite 调当前函数：upsert 卡片 → save_card_embedding([1,0]) → 同 id 改成不同正文 → 查询待建与脏向量。

```json
{"remainingEmbeddings":1,"unembedded":[],"staleSameDim":[]}
```

索引没有感知内容变化。空间/模型身份缺失和 stale 单批处理是源码确认项，未调用收费远端 embedding。

## 4. 依赖扫描与适用条件

最初两次 npm audit 被本机失效代理 `127.0.0.1:10808` 拒绝，不能当作“无告警”。第三次仅在该命令进程清除代理环境、用 `--proxy=null --https-proxy=null` 成功读取 registry，没有修改用户全局配置。

实际安装树：

```text
vitest@3.2.7
  @vitest/mocker@3.2.7
  tinypool@1.1.1
```

完整 npm audit 返回受影响包节点：2 critical、1 moderate；`npm audit --omit=dev` 返回 **0 已知告警**。这里的 0 只代表本次 npm 数据库针对这份生产树的结果，不代表所有代码、Rust、Gradle 或安装包已经过安全审计。

维护者公告已实际打开核对：

- [GHSA-5gmw-xhrv-c9v3](https://github.com/tinylibs/tinypool/security/advisories/GHSA-5gmw-xhrv-c9v3)：原型污染配合 worker options 的利用条件；patched 2.1.1。
- [GHSA-85c8-ppgw-ccpr](https://github.com/tinylibs/tinypool/security/advisories/GHSA-85c8-ppgw-ccpr)：run options 的相关利用条件；patched 2.1.2。
- [GHSA-82fw-gwwq-j7x9](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9)：公开 Mocker 插件路径的读取边界；并非所有 Vitest 使用方式都默认公开可达。
- [GHSA-qxg6-89mg-rqv8](https://github.com/vitest-dev/vitest/security/advisories/GHSA-qxg6-89mg-rqv8)：manual mock 注册路径；维护者列出 4.1.12/5.0.3 修复。

不在审查里自动修改依赖；执行者须重新核对届时公告、引擎要求与已解析树，不能直接照抄某个版本号作为升级方案。

## 5. 不确定项与未执行范围

- 没有在本轮实际安装 Windows/Linux 包，没有完整桌面关闭/重启录音验收。
- 没有真实 IMAP、真实模型内容质量、真实物理麦克风或大型用户私有库样本。
- 恢复“第 N 项失败”和浏览器损坏值保护是代码路径确认；没有对用户真实数据库/磁盘做故障试验。
- 没有对所有依赖、全部许可证、所有网络攻击面做穷尽检查。
- 没有把全仓关键词扫描的部分结果当作“问题清零”。

这些限制不影响已复现的数据问题成立；同样不能把未验证功能直接判为已坏或已通过。

## 6. 收尾结果

固定 `9e8331c` 源码快照上的 **14 套浏览器回归全部通过，运行器退出码 0**：taste、workspace、brain、import、notes、notes_editor、mailbox、review、scale、settings_plugins、subscriptions、source_matrix、usability_journey、desktop_interaction。

其中笔记编辑 20 项、手写/合成录音 40 项、邮箱 45 项、复习 19 项、桌面式键鼠交互 22 项断言通过。名称含 desktop 的这一套仍是浏览器交互验证；真正 `desktop_external_write_smoke` 因桌面客户端未运行 **SKIP**。

先前超时的批量分类在固定快照上通过，因此未将那次超时列为独立产品缺陷。首轮 `verify_workbench.sh` 本身仍以失败结束，记录予以保留；最终结果应准确表述为“编译/逻辑/守卫通过，独立重跑浏览器 14 套通过，真机专有未验”，不能覆盖掉首轮失败或宣称完成所有平台验收。

以上通过结果与本轮数据问题不矛盾：既有套件没有验证 E01–E08 的这些特定转换。最后核对了文档链接、问题与任务覆盖、JSON、LF/空白和源码指纹；本轮交付没有改写产品实现。
