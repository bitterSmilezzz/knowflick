# Android 0.8.1 修复记录

日期：2026-09-13。用户报告手机上存在多处问题；本轮先修复下列在 0.8.0 安装包上独立复现的问题。用户的具体机型、系统版本和问题清单尚未收到，不能认定已覆盖所有真机问题。

## 已复现与修复

| 操作 | 0.8.0 表现 | 修复 |
| --- | --- | --- |
| 点击卡片“查看详情”提示 | 无反应 | 为顶卡补充点击操作，与拖拽手势共存 |
| 从收藏进入详情，再返回 | 跳回刷卡页 | 记录详情来源，返回原知识库页面 |
| 点击历史卡片 | 无反应 | 补齐历史行详情回调 |
| 历史详情返回 | 原页无法保留 | 保存知识库标签、筛选和滚动状态 |
| 在详情页旋转手机／重建 Activity | 详情丢失，回到卡堆 | 保存页面、卡片 ID、返回目标，重建后恢复 |

详情通过卡片 ID 读取当前版本数据，避免把整个卡片快照存入页面恢复状态；卡片更新时重新读取最新状态。

## 验证

0.8.0 的实际坐标操作探针两次重现点击卡片、收藏详情返回和旋转三处失败。新增 `NavigationRegressionTest` 的 4 项测试修复前全部失败，修复后全部通过。

完整回归：65 项 JVM 测试、18 项 Android 15 ARM64 模拟器测试通过，包含原有刷卡测试和新的实际触摸、返回、Activity 重建测试。Debug Lint 无错误。

最终签名 APK 的坐标复测三项全部通过；0.8.0 覆盖升级至 0.8.1 成功，原收藏数、收藏卡片文字、历史条数均保留，无需卸载旧版。

版本为 0.8.1，versionCode 9，复用 0.8.0 发布签名，启用 R8 和资源压缩。产物由 `tools/build_android.sh --connected` 构建、验证签名和 ZIP 对齐。

## 文件

- [签名 APK](../dist/android/KnowFlick-0.8.1.apk)
- [SHA-256 校验文件](../dist/android/KnowFlick-0.8.1.apk.sha256)
- 构建与测试结果：`dist/android/0.8.1-validation/`

## 范围

本轮没有连接用户手机，未验证该手机的厂商系统、真实 API 服务、全部字体与显示缩放组合。需要用户提供机型、系统版本及“操作步骤 → 异常表现”，继续对齐实际问题。

参考：[Android UI 状态保存](https://developer.android.com/develop/ui/compose/state-saving)、[Compose 手势处理](https://developer.android.com/develop/ui/compose/touch-input/pointer-input/understand-gestures)。
