# Android 0.8.0 APK 交付记录

日期：2026-09-12 至 2026-09-13。目标：交付可安装 APK，未上传 GitHub Release 或应用商店。

## 最终交付

- [KnowFlick 0.8.0 签名 APK](../dist/android/KnowFlick-0.8.0.apk)：8,243,305 字节（7.86 MiB），版本代码 8，非 Debug 构建。
- [SHA-256 校验文件](../dist/android/KnowFlick-0.8.0.apk.sha256)、[构建与签名校验记录](../dist/android/build-validation.log)、[设备验收记录](../dist/android/release-smoke.json)。
- R8 mapping 位于 `dist/android/KnowFlick-0.8.0-mapping.txt`。
- APK 签名（v2）和 ZIP 对齐校验通过；在 Android 15 ARM64 模拟器上成功安装。
- 最终签名包在 320dp 窄屏完成实际坐标点击验收：冷启动、换一批后卡片变化、收藏与知识库、详情、统计、设置、未配置 AI 的提示、系统返回；强制停止后重新打开，收藏数仍为 1。

APK SHA-256：

```text
696a13bb4f918a43bb37aca8957c45332e3ed26f33702953b20f359c032ce0d1
```

[标准手机界面截图](../dist/android/release-phone.png) · [320dp 窄屏截图](../dist/android/release-compact.png) · [详情截图](../dist/android/release-detail.png) · [设置截图](../dist/android/release-settings.png)

## 本轮开发与优化

- 刷卡、跳过、收藏、重新探索接入 ViewModel 的统一变更入口，触发 Compose 更新并安排保存。
- JSON 导入后安排保存，避免停留前台时新增卡片只存在于内存。
- 350ms 节流改为可取消的协程延迟；主线程采集不可变卡片快照，单线程 IO 队列按提交顺序写入。离开前台时取消待执行延迟并排空最新写入，防止旧快照覆盖新状态。
- AI 请求仍在服务内部使用 IO 调度器；生成结果回到主线程修改卡库和界面状态，协程取消继续向上传递。
- 图片在 IO 线程解码，使用 12 MiB LRU 缓存限制已解码图片的持有量。缓存淘汰不直接 recycle，避免破坏仍被界面引用的 Bitmap。
- 刷卡动画改由拖拽状态变化触发，移除空闲状态下每 16ms 一次的轮询。
- 顶栏标题采用弹性宽度和单行省略，修复 320dp 窄屏中“换一批”按钮被挤出屏幕的问题。
- 根布局增加系统安全区域边距，并统一启用 edge-to-edge，避开 Android 15 的状态栏、导航栏和屏幕开孔，修复顶栏视觉重叠及触摸被系统拦截的问题。
- Android 版本从工程中的 0.1.0 / 1 更新为 0.8.0 / 8。
- Release 启用 R8 与资源压缩，使用独立本地发布证书；构建脚本执行测试、签名验证、ZIP 对齐验证并输出 APK、SHA-256 与 mapping。

## 回归证据

新增 `ReleaseReadinessTest`，修复前执行：

```sh
cd android
./gradlew :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.knowflick.app.ReleaseReadinessTest
```

结果：3 项中 2 项失败。收藏和导入后等待 5 秒，持久化文件仍未更新；系统返回测试通过。返回处理原本已经存在，本轮保留该行为并补充回归覆盖。

初次合并验证遇到两类问题：原有模拟器读取系统信息超时，设备测试未能执行；首次 R8 构建发现 Tink 的四个可选 Error Prone 注解缺失。设备测试改到独立 AVD，构建脚本将设备测试与 R8 分阶段执行。注解问题使用精确四条规则解决，未关闭 R8 或全局屏蔽缺失类检查。背景图加载的 Compose Lint 检查则通过改用 `remember` + `LaunchedEffect` 的显式状态更新解决。

最终 APK 实际坐标点击还发现了 Android 15 状态栏覆盖顶栏的问题：语义层点击可以通过，但用户点击收藏阁的坐标仍落在系统栏区域。已在根布局处理安全区域，并增加顶栏位置相对系统状态栏的回归断言；最终验收继续使用实际触摸坐标。

## 自动化测试结果

| 检查 | 结果 |
| --- | --- |
| JVM / Robolectric / MockWebServer | 65 项通过，0 失败，0 跳过 |
| Android 15 独立模拟器仪器测试（320dp 窄屏） | 14 项通过，0 失败，0 跳过 |
| Debug Lint | 0 错误、8 警告 |
| `git diff --check`、打包脚本语法 | 通过 |

Lint 剩余警告为现有凭据写入使用同步 commit，以及六项依赖版本更新提示。为保持发布前验证范围稳定，本轮没有批量升级依赖。

## 签名与后续更新

本机私钥及配置备份：`~/.local/share/knowflick/signing/`。私钥、密码配置均不提交到 Git。后续版本必须复用这份签名，发布目录应另外安全备份。R8 mapping 随每个版本保存，以便还原崩溃堆栈。

复现完整构建，在仓库根目录执行：

```sh
ANDROID_SERIAL=emulator-5556 ./tools/build_android.sh --connected
```

其他设备使用其实际 serial。不连接设备时可省略 `--connected`，但这不代表已通过设备测试。

## 验证边界

最低版本声明为 Android 8.0 / API 26；本轮设备验证使用 Android 15 / API 35 ARM64 模拟器。没有连接实体手机，不能据此宣称已覆盖所有安卓版本、厂商系统或设备性能。

AI 和远程语音测试使用本地 MockWebServer，未用真实付费服务商账号发起调用；真实账号、网络环境以及实体设备系统 TTS 效果需后续验证。现有凭据实现遇到 Keystore 初始化失败会回退普通本地偏好存储，这一行为未在本轮更改。

刷卡交互、图片 IO 和缓存做了明确的机制优化，但未进行低端真机帧率或电量基准测试。不可将模拟器启动耗时当作用户手机的性能承诺。

## 参考资料

- [Android 发布准备](https://developer.android.com/studio/publish/preparing)
- [Android 应用签名](https://developer.android.com/studio/publish/app-signing)
- [Tink 的 R8 可选注解问题](https://github.com/tink-crypto/tink-java/issues/7)

- [Compose 系统安全区域处理](https://developer.android.com/develop/ui/compose/system/insets-ui)
