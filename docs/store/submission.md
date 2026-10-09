# Chrome Web Store 提交清单（ALAG-14，unlisted 首次提交）

照这份清单逐字段填开发者控制台（https://chrome.google.com/webstore/devconsole）。要粘贴的英文原文都在旁边的文件里，这里只写字段 → 来源；后台字段名以实际界面为准，顺序按控制台左侧标签。每项前面的方框提交时勾掉。

## 0. 提交前核对（2026-10-09 已做，提交当天再做一遍）

- [ ] 账号页（Account）：发布者名 **ThinkAsModel Limited**；联系邮箱 hello@alayo.ai 已验证；欧盟 DSA trader 声明已填（公司主体选 trader，地址与联系方式会在欧盟商店页公开）。这三项缺一项 publish 会卡住。
- [ ] 包：`npx wxt zip` 产物 `.output/alayo-get-0.1.0-chrome.zip`，基于 main `559e6f3`，SHA-256 `c9e904d3f2d6085270685ade237e869ab8e9a91720679539c3dc6c6f4cca8ebd`（301.57 kB，21 个文件，含 LICENSE / NOTICE / THIRD_PARTY_LICENSES.md / manifest.json / `_locales/{en,zh_CN,zh_TW}`）。提交前若 main 又有新提交，重新 `bash verify.sh full` + `npx wxt zip` 并更新这行。
- [ ] 链接全部 200：`https://alayo.ai/en/get/privacy`、`https://alayo.ai/zh/get/privacy`、`https://alayo.ai/en/get/help`、`https://github.com/thinkasmodel/alayo-get`（仓库为 public）。
- [ ] 素材：`docs/store/assets/` 下 5 张 1280×800 截图与 1 张 440×280 小宣传图，均为 24 位 PNG 无 alpha（`bash scripts/store-assets.sh` 生成并自检）。这些是按设计稿源拼的合成图，不是实机截图；**用户确认后才上传**。

## 1. Package（上传包）

- [ ] 上传上面的 zip。后台会从 manifest 读出名称 `Alayo Get`、简介 `Save web pages as local Markdown files`（`__MSG_extDescription__`，英文为默认语言）、版本 `0.1.0`、权限 `storage` `scripting` `contextMenus` `activeTab` `tabs` 与 host `<all_urls>`。
- [ ] 被拒后重提：manifest `version` 必须比上一次大（改 `package.json` 的 `version`，wxt 从那里取）。

## 2. Store listing（商店信息）

| 字段 | 填什么 | 来源 |
|---|---|---|
| Title | 取自 manifest，不可改 | — |
| Summary | 由 manifest 的 `extDescription` 决定（`Save web pages as local Markdown files`），用了 `__MSG_` 本地化键后后台不可手改；`listing.*.md` 的「Short description」段用不上。要换成那段 116 字符的版本得改 `public/_locales/*/messages.json`，属代码改动，本票不做 | — |
| Description | `listing.en.md`「Detailed description」整段 `text` 块 | `docs/store/listing.en.md` |
| Category | Productivity | — |
| Language | English；再在语言切换处添加 **中文（简体）**，Description 用 `listing.zh.md` 的 `text` 块 | `docs/store/listing.zh.md` |
| Store icon | 从 zip 的 128×128 图标自动取；需另传时用 `public/icon/128.png` | — |
| Screenshots | 按顺序传 `01-save` `02-files` `03-kinds` `04-ways` `05-privacy` | `docs/store/assets/` |
| Small promo tile 440×280 | `promo-440x280.png` | `docs/store/assets/` |
| Marquee 1400×560 | 不传（可选） | — |
| Official URL | 只能选已在 Search Console 验证的站点；没验证就留空 | — |
| Homepage URL | `https://github.com/thinkasmodel/alayo-get` | — |
| Support URL | `https://alayo.ai/en/get/help` | NKS-663 |
| Mature content | No | — |

## 3. Privacy（隐私实践）

| 字段 | 填什么 | 来源 |
|---|---|---|
| Single purpose | `permissions.md`「Single purpose」一段 | `docs/store/permissions.md` |
| Permission justification：`<all_urls>`、`scripting`、`tabs`、`activeTab`、`storage`、`contextMenus` | 各对应小节；方括号里的文件引用不粘 | 同上 |
| Remote code | **No**，说明用「Remote code」一段 | 同上 |
| Privacy policy URL | `https://alayo.ai/en/get/privacy` | NKS-663 |

**Data usage（数据使用勾选区）**——用户 2026-10-09 定：**按填法 A，只勾 Website content**。三种填法的依据保留如下：

- 事实：扩展不把任何数据传出设备；但在 `chrome.storage.local` 里保存「已保存记录」（用户主动保存过的页面 URL、标题、文件名、标签、批注、保存时间），并把网页内容写进用户选的本地文件夹。商店 User Data FAQ 把「handle」定义为 collecting、transmitting、using、sharing，并写明即使只在设备本地处理或存储也要披露（`https://developer.chrome.com/docs/webstore/program-policies/user-data-faq`）；没有找到「本地存储不算 collect」的原文。
- **填法 A（建议）**：只勾 **Website content**（保存的就是网页正文、图片、链接；Obsidian Clipper 与 Notion Web Clipper 的商店页也只披露这一项）。商店页会显示「handles the following: Website content」加三项声明，与隐私政策「What is stored on your device」一段一致。
- **填法 A′**：A 之外再勾 **Web history**（已保存记录含页面 URL、标题、时间，虽只是用户主动保存的那些页）。最保守，但同类扩展没有这样披露的，商店页会显得像在记录浏览历史。
- **填法 B**：一项都不勾，按「不收集」理解 collect（数据不出设备；SingleFile 这样填）。商店页显示 will not collect or use your data，更好看；风险是审核员按 FAQ 口径认定漏报，拒绝理由会落在「inaccurate disclosure」。
- 同类扩展的实际披露见本文件末尾「附：同类扩展」一节（2026-10-09 抄录）。

- [ ] 三项 certification 全勾。商店页显示的原文（2026-10-09 抄自同类扩展商店页）：
  - Not being sold to third parties, outside of the approved use cases
  - Not being used or transferred for purposes that are unrelated to the item's core functionality
  - Not being used or transferred to determine creditworthiness or for lending purposes

## 4. Distribution（分发）

- [ ] Payments：Free。
- [ ] Visibility：**Unlisted**（不进商店搜索与分类，知道链接的人都能装；审核要求与 public 相同）。
- [ ] Regions：All regions。

## 5. 给审核员的说明（如有 Test instructions / Additional notes 字段）

```text
Alayo Get writes files to a local folder through the File System Access API, so it needs one setup step before the first save:

1. After installing, the extension opens its setup page. Click "Choose folder…", pick any empty folder on your disk (for example, create one called "Alayo Get"), then click "Start".
2. Open any article page and click the toolbar icon (or press Alt+Shift+S). The panel shows "Saved to library" and the Markdown file appears in the folder you chose.
3. To save a quote: select text, right-click, choose "Save quote to Alayo Get".
4. On x.com post pages, saving an author's thread scrolls the page and clicks X's own "show replies" control to load the rest of the thread (at most 50 posts or 15 seconds), then scrolls back. This is the only case in which the extension changes anything on a page.

No account, no server. All network requests go to the site of the page being saved (and the hosts of its images or video), only while a save runs.
```

## 6. 提交后

- [x] 2026-10-09 17:15 左右用户提交审核。后台 item `jfjpdjepihaifdfgflodadkdgidnpecg`，控制台 https://chrome.google.com/webstore/devconsole/21b428b5-1203-4cdb-818c-12ddcb5c7925/jfjpdjepihaifdfgflodadkdgidnpecg/ ；过审后商店链接为 https://chromewebstore.google.com/detail/jfjpdjepihaifdfgflodadkdgidnpecg 。提交时弹「Broad Host Permissions」深度审核提示，照常提交。`logs/ops.md`、Linear ALAG-14 已记；ALAG-12 已 Done。
- [ ] 审核被拒：把拒绝邮件原文记入 ALAG-14 评论；修正后 `version` 递增重提；要求改权限则另开实现票。
- [ ] 过审（状态 Published，unlisted）：
  - README 的 `<!-- CWS_URL -->` 占位：`grep -n CWS_URL README.md README.zh-CN.md`，共四处，换成商店链接并去掉「Coming soon / 即将上架」。
  - 用链接装一次，完成一次保存（票面判据）。
  - ALAG-14 Done；切 public 归 ALAG-15。

## 附：同类扩展的数据披露（2026-10-09）

商店页 Privacy practices 区块，由 scout 用 WebFetch 抄录，未直接看原始页面：

| 扩展 | 披露的数据类别 |
|---|---|
| Obsidian Clipper（`mphkdfmipddgfobjhphabphmpdckgfhb`） | Website content |
| Notion Web Clipper（`knheggckgoiihginacbkhaalnibhilkk`） | Website content |
| Raindrop.io（`ldgfbffkinooeloadekpmfoklnobpien`） | Personally identifiable information（有账号） |
| SingleFile（`mpiodijhokgodhhofbcjdecpffjipkle`） | 无：「The developer has disclosed that it will not collect or use your data.」 |
| MarkDownload（`pcmpcfapbekmbjjkdalcgopdkipoggdi`） | 没取到页面 |

四页都带同一组三项声明。商店官方文档里：User Data FAQ 把 handle 定义为 collecting、transmitting、using、sharing，并写明本地处理或存储也要披露；素材要求「1280x800 or 640x400」「at least 1, up to 5」、小宣传图「440x280」必填、Marquee 可选；unlisted「does not create a listing」「anyone can install if they know its URL」、审核要求与其他可见性相同；更新包「Each new version must have a larger version number」（`developer.chrome.com/docs/webstore/` 下 user-data-faq、images、cws-dashboard-listing、cws-dashboard-distribution、update 各页）。
