# Android 凭据写入移至 IO：独立 Code Review

## 审查元数据

- 外部审查软件：Antigravity
- Agent：Antigravity Code Review Agent
- 模型：Gemini 3.8 Flash (High)
- 审查时间：2026-09-24 UTC
- Base：`origin/main` `0448f40b2e05a8594e79a4cde58f261c92923195`
- 首轮候选：`6bd06e73cd04a5a2a0d0f8cb5e66a7b4c61b8ef6`
- 最终产品候选（本报告写入前的树）：`f9e6ca4e10dc3b8f808fb2ac49508a3f57628a5b`
- 隔离 worktree：`/tmp/knowflick-20260924T205153Z`
- 最终审查补丁：`/tmp/knowflick-20260924T205153Z-final-review-v2.patch`
- 审查范围：相对 base 的全部 Android 产品实现、关联单元与仪器测试、版本配置、CHANGELOG、README 和 Android 发布说明。
- 审查方式：Agent 只读静态审查，没有修改文件、运行构建/测试、提交或推送。最终补丁与暂存 diff 逐行一致。本报告在复审通过后加入；原审查结论对应上述最终产品候选。CI 后续发现的测试适配修复记录见文末。

## 首轮确认问题及处理

1. **P1：异步凭据接口导致现存 androidTest 无法编译。** `CredentialPersistenceTest` 与 `ReleaseReadinessTest` 中的 `CredentialStore.save/delete` 调用已放入 `runBlocking`；当前 `:app:compileDebugAndroidTestKotlin` 编译通过。
2. **P1：设置保存异步化后，仪器测试存在时序竞态。** `ReleaseReadinessTest` 串行触发 AI 与语音保存，并在后续断言前等待保存完成；`SpeechRemoteChannelTest` 在主线程触发语音配置保存并等待完成后再发起合成请求。
3. **P2：凭据写入失败时，提示称配置已生效但运行态仍会使用旧密钥。** AI 增加会话内存覆盖；语音控制器运行态使用本次提交的密钥。反馈明确指出设备凭据未持久化以及重启后的影响；没有记录或输出密钥。
4. **P2：AI 与语音保存反馈共用区域且状态粘住。** 两处反馈拆分并放在各自保存按钮附近；表单首次进入或字段变化时分别清除对应提示。

最终审查逐项复核以上修复，确认均已闭环，未发现未解决的确认问题。

## 保留的非阻塞观察

- **P3，初审推测观察：** 凭据读取和 `EncryptedSharedPreferences` 初始化仍是同步操作，ViewModel 初始化和设置入口可能在主线程读取凭据。本轮目标只把保存/删除路径移至 IO；这个边界已写入 Android 发布说明，读取路径未改。
- **P3，初审测试建议：** 尚无专门覆盖 ViewModel 异步保存成功、失败与互斥状态迁移的 JVM 单元测试。本轮新增存储 dispatcher 单测，并修复现有仪器测试时序；因该建议未被确认为缺陷，暂不扩大本轮范围。

## 最终复审结论

第二轮由同一 Antigravity Code Review Agent（Gemini 3.8 Flash (High)）审查最终暂存树 `f9e6ca4e10dc3b8f808fb2ac49508a3f57628a5b` 与上述 base。Agent 确认能够读取 worktree 和完整补丁，复查原四项问题、协程取消与异常处理、写入互斥、凭据安全/隐私及配置反馈状态。

**结论：Approved；未解决确认问题为 0。** 最终复审为静态审查，不替代本地构建、测试或后续 GitHub Actions 检查。

## 本地验证

- `cd apps/android && ./gradlew :app:compileDebugAndroidTestKotlin`：通过。
- `./tools/build_android.sh`：退出码 0；Debug JVM 单测 265 项通过，失败/错误/跳过均为 0；Debug Lint、Release/R8、签名与 APK 验证通过。
- `shasum -a 256 -c dist/android/KnowFlick-0.10.2.apk.sha256`：APK 校验通过。
- `unzip -tq dist/android/KnowFlick-0.10.2.apk`：ZIP 完整性通过。
- `adb devices`：没有连接的 Android 设备；因此仪器测试未运行，但仪器测试 Kotlin 源码已单独编译。
- `git diff --cached --check`：通过。
- 敏感信息扫描：最终暂存补丁、APK、SHA-256 sidecar、mapping 和 JVM 测试 XML 无 gitleaks findings。构建日志的 3 个 generic-api-key 命中均来自签名校验程序输出的公开证书/公钥摘要；扫描报告已脱敏，未读取或复制签名私钥/密码。邮箱格式检查无命中。

## CI 失败后的测试适配（2026-09-25）

- GitHub Actions run `36066203037` 的单测失败是测试断言问题：Kotlin 协程调试模式会把 `@coroutine#<编号>` 附加到线程名，导致对执行器线程名做全等比较失败。
- `SystemCredentialStoreTest` 现在捕获测试执行器工厂创建的线程对象，并对保存与删除分别断言执行线程与该对象为同一实例。这样继续验证注入的 dispatcher 生效，同时不依赖运行时修改的线程名。生产实现未改动。
- 此测试适配发生在上方独立审查之后；上方审查记录未覆盖该后续测试差异。
- 修复后以 `-Dkotlinx.coroutines.debug=on` 运行 265 项 JVM 单测、`lintDebug`、`assembleDebug` 与 `assembleRelease`，全部通过。
