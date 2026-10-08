# ADR-0001：Get 只往文件系统写，第一阶段只对接 Workbench

- **状态**：已采纳
- **日期**：2026-10-06

## 决策

Get 采集的结果只落成本地剪藏库里的文件，不调用任何 Alayo API。Workbench 把剪藏库设为监控目录，由它把剪藏纳入画布。第一阶段不对接 Notes。

写入通道选定 **File System Access（FSA）**，句柄存入 IndexedDB，剪藏库保留在 `~/Documents/Alayo Get/`。M0 在独立 Chrome for Testing 153.0.8010.12 扩展中实测：首次 picker 只给本次授权；恢复已存句柄时调用 `requestPermission({mode: "readwrite"})` 并选择“每次访问时都允许”后，完整进程更换仍返回 `granted`，service worker 无需重授权即可写入。

每次写前仍需 `queryPermission`；若为 `prompt`/`denied`，由用户点击扩展页面恢复授权，后台不能弹提示。首次设置必须解释持久授权选项，不把“句柄已存”当作“权限永久有效”。本轮不启用 offscreen，也不退回 downloads。正式版 Chrome 154、权限撤销后的产品恢复流程及无页面冷启动不在本轮通过范围。实测及退出方式限制见 [ALAG-1 记录](../research/ALAG-1-results.md)。Workbench 两项 GUI 实测已完成：本地相对路径图片可预览；`.crswap` 会进入待纳入，已建 NKS-638 跟进排除。

## 理由

- 家族约定是 Workbench 和 Notes 在文件系统层交接，不做 API 级耦合（Notes 方向备忘录 §D1）。Get 照这条做，就不会成为第一个打破它的产品。
- 基础对接沿用 Workbench 已有监控目录、"待纳入"和"按目录成组"这一套机制（31.1 CONTEXT.md:134-140）。
- Notes 目前接不进来。Notes 的 Mac 版排在 0.4 里程碑，还没交付；它现有的中转箱在 App Group 里，Chrome 扩展写不进去（Notes ADR-0008）；它的 clip 是 Journal 里的一行，装不下长文。

## 考虑过的方案

- **两边同时接**：要先给 Notes 补一个 Vault 内的中转箱，等于两个仓库一起改。而且在 Mac 上存的东西，要等 iOS 端回到前台才会被收进 Notes，体验断开。
- **Native Messaging，由 Workbench 安装时附带 host**：不会遇到重新授权的问题，但 Get 就离不开 Workbench 了，Workbench 的安装流程也要改。留到以后需要两者联动时再考虑。
- **剪藏库放 iCloud**：iOS 上的 Notes 读不到它自己 iCloud 容器以外的文件，放 iCloud 对接 Notes 没有用处；另外"优化 Mac 存储空间"可能把文件替换成占位文件。

## 后果

- 剪藏的字段按 Notes clip 的字段设计（`source`、`medium`、ULID），第二阶段接 Notes 时只需要增加一个写入目标。
- 用户首次使用时，要自己在 Workbench 里把剪藏库加为监控目录。Get 无法知道 Workbench 是否已经纳入了某个剪藏。
