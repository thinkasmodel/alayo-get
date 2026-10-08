# ALAG-8 虚拟机复测（2026-10-08）

测试输入：`alag-8` / `8aa38db`（包含图片修复 `471c904`）。仅实测和记录，没有改实现或测试断言。

## 构建和验证

- 宿主执行 `npx wxt build`，退出 0。
- 主代理观察 `bash verify.sh full` 退出 0：55 个测试文件、595 项测试，生产构建和 manifest 检查通过。
- 日志：本机证据目录（未入库）。

## Windows 图片附件

UTM Windows 11 ARM64，官方 Chrome 155.0.8059.40。完整复制新构建到 `C:\Users\<user>\ALAG7-Test\chrome-mv3`，18 个文件 SHA-256 与宿主构建一致，并在 `chrome://extensions` 的 Alayo Get 卡片点击 Reload。

使用新的 `C:\Users\<user>\Documents\Alayo Get Retest` 剪藏库，保留上轮失败样本。Windows 自动锁屏后由用户解锁继续；解锁后再次从扩展卡片 Reload。三篇文章均从工具栏打开面板，因已有保存记录而选择 “Save new snapshot”，重新抓取和下载。刷新后的文件夹权限通过原生提示选择 “Allow on every visit”，Plain text 的待存记录成功补写。

| 文章 | 有效图片 | HTML 网页 | 图片引用 |
| --- | ---: | ---: | --- |
| Plain_text | 1 | 0 | 全部存在 |
| Typography | 9 | 0 | 全部存在 |
| Hypertext | 6 | 0 | 全部存在 |
| 合计 | **16** | **0** | **16/16 存在** |

将实际写入的完整测试库导出，原样复用上轮 `check-image-payloads.py`，退出 0：

```text
16/16 actual images; 0 invalid image payloads
```

补充检查确认 3 个 Markdown 的 source 对应指定 URL，16 个附件均非空且 PNG/JPEG 签名有效，Pillow 图片校验全部通过；HTML 和未知格式数量均为 0。结束时 Chrome 扩展 runtime / manifest errors 均为 0。

结论：本轮三篇维基百科文章的附件内容复测通过。

证据目录：本机证据目录（未入库），包含完整 `library/`、原始检查脚本、`image-payload-check.json`、`summary.json`、`build-hashes.json`、`runtime-errors.json` 和实际保存截图。宿主 Mac 与 Windows 虚拟机新构建的 18 个文件 SHA-256 对照已通过。

## 香港中文（Mac）

UTM macOS 26.6.2（25G83），官方 Chrome 155.0.8059.40，同步了本轮构建并 Reload。按用户命令执行：

```sh
defaults write com.google.Chrome AppleLanguages '(zh-HK)'
```

通过虚拟机内原生 CoreGraphics 按住 ⌘Q 2.5 秒，确认 Chrome 主进程消失，再重开同一测试 profile；PID 从 `4432` 变为 `6908`。

| 检查 | 实测结果 |
| --- | --- |
| defaults 读回 | `(zh-HK)` |
| 设置页 DevTools 控制台执行 `chrome.i18n.getUILanguage()` | `"zh-TW"` |
| 设置页 | 中文：设置、剪藏库、保存方式 |
| 工具栏实际面板 | 中文：已于 2026-10-08 保存过、本次没有写入、另存一份新快照 |
| `navigator.language`（辅助记录） | `zh-CN`，与 Chrome UI locale 不同 |

结论：此环境中 `zh-HK` 经 Chrome 解析为 `zh-TW`，扩展显示简体中文。原 ADR 中“zh_HK 回落英文”的笼统结论不符合此次实测，已补正；不推广到未测版本/平台。

测试后删除原本不存在的 AppleLanguages 覆盖，完整退出重开，读回 `getUILanguage()` 为 `en-US`。

证据：本机证据目录（未入库），包含 `result.json`、`panel.txt`、`panel.png`、`settings.png`、`console-result.png`。
