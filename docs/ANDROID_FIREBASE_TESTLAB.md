# Android 仪器测试 · Firebase Test Lab 接入指南

> 背景：GitHub 托管 runner 无法跑 Android 模拟器（Linux 无 `/dev/kvm`；macOS 嵌套虚拟化不透传，
> `HVF error: HV_UNSUPPORTED`，两轮实测见 PR #31 关闭评论）。Firebase Test Lab（FTL）虚拟设备
> 有免费额度，是不动钱、不依赖本机开机的唯一路径。

## 一次性设置（约 10 分钟）

1. **创建 GCP 项目**（已有则跳过）：[console.cloud.google.com](https://console.cloud.google.com) → 新建项目，名字任意（下称 `PROJECT_ID`）。Test Lab 会自动启用，无需手动开通 API。
2. **创建 service account**：IAM 与管理 → 服务账号 → 创建服务账号（名字任意，无需角色——Test Lab 权限按项目级授予即可，空角色 SA 能跑 Test Lab）。
3. **授予 Test Lab 权限**：项目级 IAM 里给该 SA 绑定 **Firebase Test Lab Admin**（`roles/firebase.testlabadmin`）。
4. **生成 JSON 密钥**：服务账号 → 密钥 → 添加密钥 → JSON，下载得到密钥文件。
5. **注入仓库 secret**：

   ```bash
   gh secret set FIREBASE_SERVICE_ACCOUNT < 下载的密钥.json
   ```

6. 完成。到 Actions → **Android Firebase Test Lab** → Run workflow 手动触发。

## 运行与读结果

- 工作流会构建 debug APK + androidTest APK，提交给 FTL 的 Pixel2 虚拟设备（API 34，zh_CN，竖屏）跑全部 34 项仪器测试（导航回归 / ReleaseReadiness / 凭据持久化 / 语音通道 / 卡堆）。
- 结果链接打印在日志末尾（`Firebase Test Lab` 的 results 目录）；历史结果按 `knowflick-instrumented-<日期>` 归组，也能在 [Firebase 控制台 → Test Lab](https://console.firebase.google.com) 里看每项用例的截图与 logcat。
- 失败时 FTL 的原生日志比本地 emulator 输出更完整（含截图与性能曲线）。

## 免费额度与消耗

- FTL 免费额度：虚拟设备 **30 设备-小时/天**。一轮 34 项测试约 3-5 设备-分钟，一天跑几十轮都用不完。
- 因此刻意只做 `workflow_dispatch` 手动触发，不接推送/PR 门禁——额度模式摸清后若要自动跑，把 `on:` 段的 `workflow_dispatch` 换成/加上 `pull_request`（路径过滤抄 `android.yml`）。

## 常见问题

- **403 permission denied**：SA 没绑 `roles/firebase.testlabadmin`，或密钥属于别的项目。
- **找不到 APK**：`assembleDebugAndroidTest` 必须与 `assembleDebug` 一起跑（工作流已一起跑）。
- **想换设备矩阵**：改 workflow 里的 `--device` 行，可逗号分隔多档（如再加 `model=Pixel6,version=35`），FTL 会并行跑并分别计时长。

## 为什么不用另外两条路（2026-09-30 实测记录）

| 路径 | 结论 |
| --- | --- |
| GitHub Linux runner + GMD/模拟器 | 无 `/dev/kvm`（kvm-probe 实测），模拟器无硬件加速 |
| GitHub macOS runner + 模拟器 | runner 本身是虚拟机且不透传嵌套虚拟化：`HVF error: HV_UNSUPPORTED`；adb daemon 还需手动拉起（救不了 HVF） |
| 付费 larger runner | 可行但要开计费；FTL 免费额度足够时不必 |
| 自托管 runner（本机 mac） | 可行但构建依赖本机开机；留作 FTL 之后的备选 |
