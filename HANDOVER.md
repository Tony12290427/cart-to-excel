# 交接文档 — cart-to-excel（淘宝购物车 → HKUST 订购表）

> 面向接手继续开发的 AI / 开发者。本文档记录**现状、机制、踩过的坑、以及怎么验证**。
> 最后更新：接手时的仓库状态见文末「交接检查清单」。

---

## 2026-10-14 接续更新 订单管理第一版

新增独立 `platform/`：React 19 + Vite 前端、Node 22.22.2 + SQLite 后端、Google 登录和成员角色、Drive 只读定时同步、标准 XLSX / Google 表格导入、下单数量、到校批次、学生按 item 和数量验收、异常及可追溯更正。真实部署配置、启动和验收步骤见 [platform/README.md](platform/README.md)。原导出/上传网页保持现有机制。

用户要求管理平台前端采用 React，已将原 `platform/public/` 的拼接 HTML 页面迁移为 `platform/frontend/src/` 的 JSX 组件。`npm start` / `npm run demo` 自动构建；生产静态产物在被忽略的 `platform/dist/`，由同一 Node 服务提供。`npm run build:watch` 可监视前端修改并在原地址刷新预览。后台 API、数据库和 Google OAuth 来源不变；前端构建不加载后台 `.env`。Dockerfile 改为分阶段构建。前端流程测试使用内存数据库，实际订单不写入测试进度。

已确认业务：管理方确认送到学校；所有获准团队学生都可领取并验收，记录实际操作人。通常整份表一起下单集运，支持分批及部分 item 未到。历史表先待核实，预算表可排除；未知真实进度不自动推定为已下单。

本机虚构订单已跑通部分下单、两批到校、两名学生先后验收至“已到齐”；数据库重开、权限/CSRF、并发重放、过量验收、原表变更/丢失均有自动化测试。真实 Excel 与 Google 表格导出分别解析到 8/7 项。服务账号后台实际同步和真实 Google 登录验收须以配置后的结果为准，不能把演示身份当作真实接入。

用户随后明确授权本机真实接入，已创建 `order-form-reader@cart-to-order-form.iam.gserviceaccount.com`（没有赋予项目管理角色），直接将固定文件夹共享为查看者；本机私钥在仓库外私有目录，路径仅在被忽略的 `.env`。独立 `Order Platform Local` 登录客户端只允许 `http://127.0.0.1:8787`；Google 登录和服务端 token 验证实测通过，维护者为首位管理员。真实后台首轮扫描 186 个文件，登记 182 个表格候选，167 个标准商品清单解析成功，15 个保留格式/数量错误或非标准提示。后续定时扫描又发现 2 个候选表：13:15（香港时间）共扫描 188 个文件，登记 184 个候选，其中 169 个解析成功、15 个待处理。用户明确选择不新增 TEST 文件，实际订单全部保持待核实，未写入虚构下单或验收状态。

SQLite 需持久化磁盘及备份，后台是常驻单实例 Node 进程。不能直接将其数据库放在 Vercel / Cloud Run 临时文件系统中。`platform/data/`、私钥和 `.env` 不进 Git；管理平台本地登录使用独立客户端，不将本地来源重新加入已有生产上传客户端。

---

## 2026-10-11 接续更新：新版上传已启用，生产来源已收紧

用户已提供旧 Apps Script 的成功页：`20261011 wheel leg element order form.xlsx`。Drive 元数据确认它位于目标 `Order Form` 文件夹；没有返回所有者，个人归属还需在 Drive 核对。接下来用户要求解决首次 Google “未经验证／不安全”警告。

新增 `drive-upload.js`（GIS + Picker + Drive API，仅 `drive.file`）、`drive-config.js` 和 `privacy.html`；详细配置与验收步骤见 [GOOGLE_DRIVE_SETUP.md](GOOGLE_DRIVE_SETUP.md)。专用 Google Cloud 项目 `cart-to-order-form`（编号 `115821368206`）已启用 Drive/Picker、仅保存 `drive.file` 范围并正式发布。真实本地首次流程已显示普通文件权限授权页，未出现旧“未经验证／不安全”屏幕。用户已明确允许账号授权及 TEST 上传；Google Picker 成功选中目标，真实上传返回当前账号为所有者。下载回读 63,239 字节的测试 xlsx，ZIP 完整、C3/H66/F11/H11 正确且含签名 PNG。本次接入提交启用正式站点配置；另一位队员账号首次使用尚未现场实测。Google 验证中心显示无需数据访问验证，未宣称通过品牌审核。

生产 Picker key 和 OAuth 客户端已按用户要求移除 `http://localhost:8765`、`http://127.0.0.1:49530`。保存后重新打开 Console 核对：OAuth 仅有 Vercel 和 GitHub Pages，key 再保留 Picker 所需的 `https://docs.google.com/*`，API 限制仍是 Drive / Picker。本地真实上传须使用独立开发配置，不能把测试来源加回生产配置。

收紧后已在 Vercel 正式网页重新选账号并真实上传 `20261011 TEST production restrictions order form.xlsx`，文件 ID `1N_FWv--8ffxLWWXwNlxWlN1E_Sxbshwn`；固定目标文件夹、Google 返回当前账号所有权均正确。下载回读 63,252 字节，ZIP、比赛/姓名、数量/金额及测试 X 签名 PNG 全部通过。本轮使用已有文件夹授权，没有再次弹 Picker，也未测试另一位队员首次流程。

生产 key 的只读元数据探测：正式站点 Referer 返回 200；两个本地 Referer 都被 403 / `API_KEY_HTTP_REFERRER_BLOCKED` 拒绝。OAuth 来源已保存并回读，Google 提示其传播可能延迟。GitHub 公开浏览器 key 告警未因此自动解决，不能把移除本地来源描述成密钥已撤销或告警已关闭。

`index.html` 现在通过两个本地脚本加载新版配置和上传客户端；不再是运行时完全自包含的单文件。上传前把商品、姓名、比赛和签名取快照，避免用户等待 Google 授权时编辑导致文件名与表内内容错位。

下面原有章节是旧模式的机制记录。特别注意：302 登录跳转只能证明请求需要登录，不能单独确认“执行身份”；Apps Script 的代码只操作固定文件夹不代表其 OAuth 权限只覆盖那个文件夹；ZIP 标头和工作簿路径检查也不能证明文件内容安全。

---

## 1. 项目是什么

一个**纯静态单页工具**：把淘宝/天猫购物车的剪贴板内容解析成商品清单，
人工核对后套用 `template.xlsx`（HKUST Robotics Team 官方订购表）导出 Excel；
可选直接把生成的表格上传到团队的 Google Drive 文件夹。

真实使用场景：HKUST Robotics Team 队员下单买零件，需要把购物车填进官方订购表交给 IA/TA。
一单通常 20–40 个商品。

| 项目 | 值 |
|---|---|
| 仓库 | https://github.com/Tony12290427/cart-to-excel （master 分支） |
| **线上（团队实际使用）** | **https://cart-to-excel.vercel.app** ← Vercel 自动跟随 master |
| 备用地址 | https://tony12290427.github.io/cart-to-excel/ （GitHub Pages，同样跟随 master，但**比 Vercel 慢**） |
| 本地路径 | `/Users/chuntingli/Documents/cart_to_excel` |
| 维护者 | Tony（GitHub: Tony12290427，Google: tony20051229@gmail.com） |
| 规模 | `index.html` 138,849 字节 ≈ 136 KB（单文件自包含）、50+ 个提交、`.git` 51 MB |

**没有任何构建步骤**：改完 `index.html` 直接 commit + push，两个站点自动更新。
（Vercel 通常 30–60 秒；GitHub Pages 有时 1–3 分钟。）

---

## 2. 架构总览

```
淘宝购物车页
  │  Ctrl+A/Ctrl+C（实际要求：从第一个想买的商品拖选到最后一个）
  ▼
剪贴板（两种 flavor 都要用）
  ├── text/plain  → 商品名、规格、价格、促销行、界面标签
  └── text/html   → ① 商品链接 ② 购物车真实数量
  ▼
index.html 内的解析器（parseClipboardText）
  ▼
可编辑表格（改数量/单价/类型/链接，删行，继续粘贴追加）
  ▼
导出（buildWorkbookBlob）
  ├── 解 TEMPLATE_B64（把 template.xlsx 整体内嵌为 base64）
  ├── 用字符串手术替换第 11–40 行 = 30 个商品
  ├── 写入 C3(Competition) / H66(Student Name) / H74(Date)
  ├── 把签名 PNG 作为 image3.png + drawing 锚点插到 H70
  ▼
① 浏览器下载 YYYYMMDD <Competition> order form.xlsx
② （可选）新标签页表单 POST → Google Apps Script → 写入共享 Drive 文件夹
```

**没有后端**（除了可选的 Apps Script，见 §4.5）。没有框架、没有依赖管理、没有测试套件
（测试是每次现写的临时脚本，见 §7）。

---

## 3. 文件清单

| 路径 | 作用 |
|---|---|
| `index.html` | **全部代码**：UI + 解析器 + 导出 + 签名板 + Drive 上传。改这个文件就是改工具 |
| `template.xlsx` | 官方订购表模板（62 KB）。**运行时不读它**，它的内容以 base64 存在 `index.html` 里 |
| `README.md` / `README.en.md` | 中英文使用说明（有语言切换链接），面向队员非开发者 |
| `tools/drive-upload.gs` | Google Apps Script 服务端脚本（收文件写进 Drive）。见 §4.5 |
| `tools/model/` | Graves 手写模型权重（41.5 MB，**无授权**，见 §5.6）。只被 neural_signature.py 用 |
| `tools/neural_signature.py` | 可选：本地用神经网络生成手写签名 PNG（生成后再用网页的 Upload image 传进去） |
| `tools/shrink_video.swift` | 压缩教学视频的小工具（macOS 自带框架，见 §6.1） |
| `media/how-to-2.mp4` + `-poster.jpg` | 页面顶部「How to use」面板里的教学视频（1280×744, 15fps, 400kbps, 5.04 MB） |
| `.gitignore` | 忽略 `.venv-neural/`、`__pycache__/`、`.DS_Store`。**注意：`tools/model/` 是故意提交的** |

---

## 4. 核心机制

### 4.1 模板机制（改单元格 / 改模板必读）

`template.xlsx` 被**整体 base64 内嵌**在 `index.html` 的 `const TEMPLATE_B64` 常量里。
导出时用 JSZip 打开这个 base64、按字符串替换 XML、再打包下载。

**改了 `template.xlsx` 必须重新生成这段 base64**（否则页面还在用旧模板）：

```bash
cd /Users/chuntingli/Documents/cart_to_excel
python3 - <<'PY'
import base64, re
b64 = base64.b64encode(open('template.xlsx','rb').read()).decode()
s = open('index.html', encoding='utf-8').read()
s = re.sub(r'const TEMPLATE_B64 = "[^"]*"', 'const TEMPLATE_B64 = "' + b64 + '"', s, count=1)
open('index.html', 'w', encoding='utf-8').write(s)
print('ok', len(b64))
PY
```

**单元格映射表**（模板布局，已核对）：

| 单元格 | 内容 | 说明 |
|---|---|---|
| `C3` | Competition Name | `A3` 是 `Competition:` 标签；这套表是「A 列标签 → **C 列**值」的排法（`A4=Sub-team:` → `C4=Intelligent Racing`），**不是 B 列** |
| `H66` | Student Name | `G66` 是 `Name of student` 标签 |
| `H70` 起 | **签名图片**（图片锚点，占 H70 ~ J72 区域） | `G70` 是 `Sign of student` 标签 |
| `H74` | Date（导出当天） | `G74` 是 `Date` 标签 |
| 第 11–40 行 | 30 个商品行 | A 列预印序号 1–30 |
| 第 42–60 行 | 分类小计（模板自带 SUMIF） | G42:G60 的分类名必须与 JS 里 `CATEGORIES` **完全一致**，否则小计全为 0 |
| 第 61 行 | Grand Total | `=SUM(H11:H40)` |

写入单元格统一走 `setCellXML()`（按列序插入或原地替换）。
**历史 bug**：早期代码把新单元格插在行首，导致 `B3` 排在 `A3` 前面（违反 OOXML 列序），现已修正 —— 新代码请沿用 `setCellXML`。

### 4.2 为什么只能 30 行（不要试图直接改大）

- 第 11–40 行的序号 `1…30` 是**预印**的
- **所有小计公式写死了行范围**：`SUMIF($G$10:$G$40, …)`、`SUM(H11:H40)`、`SUMIF($K$10:$K$40, …)`
- 版式是 A4 一页（表头印着 `___1___page (s)`）

所以把 `MAX_ITEMS` 从 30 改成 60 是**无效且危险**的：第 31 行起不会被任何小计统计，表格会显示**错误金额**。
真要扩容必须同时改公式、样式、签名/日期行位置和版式 —— 属于改动官方表格结构。
当前策略：允许清单超过 30 条，但第 31 条起在表格里变灰标 ⚠，合计栏红字提示超出数量，**只导出前 30 条**。

### 4.3 解析器（最容易出问题的地方）

`classifyLine()` 的判定顺序**不能随意调换**：

| 顺序 | 判定 | 关键点 |
|---|---|---|
| 1 | 空行 | |
| 2 | **整行购物车标签** → noise | `CART_LABEL_RE`，见下 |
| 3 | 价格 `¥25` / `¥29.6` | 跨行价格已在 `preprocessPrice` 合并 |
| 4 | 数量：纯数字 1–4 位 | **必须在店铺判定之前**，否则 100 会被当店铺名 |
| 5 | 规格：`标签：值`（标签 2–6 字） | 通用规则，覆盖 颜色分类/版本号/飞机种类/商品规格/尺寸… |
| 6 | 商品名：**长度 > 14** 且非促销行 | **阈值必须 > 14**：店铺名最长 14 字（`金茂五金机械自动化企业店` 是 11 字），否则店铺名会变成商品 |
| 7 | 模糊短行（3–14 字） | 由**下一有效行**决定：后面是商品/短行 ⇒ 店铺；否则 ⇒ 商品（保护 `舵机 SG90` 这类短标题） |
| 8 | 其余 → noise | |

**促销词分两组**（血泪教训）：

```js
// 折扣/售后类：任何长度都过滤（这些横幅很长，会被误认成商品名）
var promoRe = /退货|退款|价保|假一赔|运费险|优惠后|满\d+件|满\d+减\d+|极速退款|不支持|立减|直降|礼金|采购无忧|补贴/;
// 可能出现在标题里的：只过滤短行（≤14 字）
var shortPromoRe = /包邮|信用卡|支付/;
```

> ⚠️ **`包邮` 必须在第二组**：卖家会把「包邮」直接写在商品标题开头
> （`包邮2倍热缩管绝缘套管…`）。一律过滤会把整条商品删掉，**上面的店铺名会顶上来当商品**。
> 另外标题开头的 `包邮` / `【包邮】` 会被 `cleanName()` 去掉。

**整行标签**（`CART_LABEL_RE`，只做整行精确匹配，所以不会误伤商品名）：

```
修改 | 删除 | 实付款? | 距.{0,8}降 |
(平台|店铺|活动|直播|会员|新人)?(优惠|加补|补贴|立减|满减|折扣|券|红包|到手)(后价|后|价)
```

**真实踩过的坑**（每一条都对应一次线上故障，新增规则时请回归这些）：

| 淘宝原文 | 曾经的错误行为 | 现在 |
|---|---|---|
| `平台加补后` / `店铺优惠后` | 被当商品 → 截走上一个真商品的价格 | 整行标签 |
| `距加入降` | 同上 | 整行标签 |
| `超级立减0.65元礼金直降满2减1采购无忧` | 太长被当商品 | 促销词（任何长度） |
| `包邮2倍热缩管…`（真商品标题） | 被当促销行丢弃，店铺名冒充商品 | `包邮` 只过滤短行 + 去前缀 |
| `金茂五金机械自动化企业店`（11 字） | 被当商品 | 阈值改 >14 |
| `版本号：新版本V2.4` | 被当店铺名，扫描中断 → 丢价格 | 通用规格规则 + 扫描只在遇到商品时中断 |
| `飞机种类：3S【T插】…` | 被当商品 → 多出假条目 | 同上 |

**数量与链接来自剪贴板 HTML，且是「按位置一一对应」**：

- `text/plain` 里**没有数量行**（淘宝数量是表单控件，浏览器不把控件值写进纯文本）
- 所以 `extractQuantitiesFromHTML()` 从 HTML 的每行 `<input value="N">` 取数量
- 页面会显示 `QTY from clipboard HTML` 表示走了这条路
- **一旦解析出的条目数与 HTML 行数错位，链接和数量会整体偏一格** —— 修 bug 时务必确认条目数正确
- 手动兜底：先粘到 macOS 备忘录再复制，数量会变成真实文本行

### 4.4 签名板与图片嵌入

- 画布**内部固定 1000×300**，CSS 按同比例显示（`padFit()`），否则"画的形状"和"导出的形状"不一致
- 指针事件（鼠标/触控板/触屏/手写笔）；中点二次曲线平滑；移动距离 <1.5px 丢弃抖动
- 导出前**按墨迹包围盒裁剪**，所以图片没有多余空白
- 也支持 **Upload image**：照片自动去白底（亮度→alpha）、裁到墨迹
- **嵌入 xlsx**：`xl/media/image3.png` + `drawing1.xml.rels` 加 `rId3` + `drawing1.xml` 追加
  `oneCellAnchor`（模板本来就有 png 的 Content-Type 和 drawing 管线，可复用）
- **锚点用 `oneCellAnchor` + 显式 `<xdr:ext>`，尺寸按图片自身长宽比算**（高 0.55 英寸，最宽 3.4 英寸）。
  ⚠️ 不要改回 `twoCellAnchor` + `<a:stretch>`：那会把图片拉伸填满单元格框，签名会被压扁

### 4.5 Google Drive 上传（当前状态：已配置，等队员授权测试）

**为什么要 Apps Script**：纯静态页面无法直接写 Drive。Apps Script Web App 是最省事的"服务端"。

**部署设置（关键，两个下拉框）**：

```
Apps Script → 部署 → 管理部署 → 编辑
    执行身份：访问 Web 应用的用户      ← 必须这个，文件才归上传者本人
    谁可以访问：任何人
版本：新版本 → 部署
```

- 用「执行身份：**我**」也能跑，但**所有文件都归部署者**，Drive 里看不出是谁交的
- 用「访问用户」→ 文件创建者 = 上传者本人、占他配额、Drive 显示"由他创建" ✓
- **代价**：文件夹必须保持「知道链接 → **编辑者**」（脚本以他的权限写文件），
  于是谁拿到链接都能删文件；每人**首次要授权一次**（会看到"未经 Google 验证"→ 高级 → 继续 → 允许）

**为什么上传是"新标签页表单提交"而不是 `fetch`**：

> 跨域 `fetch` **带不了访问者的 Google 登录态**。实测 `/exec` 对未认证请求返回
> `302 → accounts.google.com/ServiceLogin`，而登录页没有 CORS 头 → 浏览器报 `Failed to fetch`。
> **顶层跳转是第一方访问**，Cookie 正常带上，所以网页构造隐藏 `<form target="_blank">` 提交。

对应实现：`uploadToDrive()` 构造表单（`token` / `filename` / `data`(base64) / `nonce`），
脚本 `respond()` 看到 `nonce` 就返回**给人看的 HTML 页面**（成功=文件名+文件夹+打开链接；失败=错误原因），
没有 `nonce`（curl/测试）则返回 JSON。

**服务端三道校验**（`tools/drive-upload.gs`）：文件名必须匹配 `^\d{8}( .+)? order form\.xlsx$`、
内容必须是 ZIP 且含 `xl/workbook.xml`（xlsx 装不了 VBA 宏）、每天最多 50 次。
**`REPLACE_SAME_NAME = false`：接口只能新增，永不删除**（重名加 `(2)`），
所以"谁拿到公开 URL 就能删队友文件"这条路被堵死了。

**当前配置值**（都在 `index.html` 第 464–465 行）：

```js
var DRIVE_UPLOAD_URL = 'https://script.google.com/macros/s/AKfycbzvZ8iWIOuIloVzVFBF2UTnGdGtcpVXnkcL4vURrzRpFUA98-EBX74g3uO2jWLhDeLGqQ/exec';
var DRIVE_UPLOAD_TOKEN = 'WOuz9Mtt9FfTFV9dX7H2QUrLEzSs';   // 必须与脚本里 TOKEN 完全一致
```

目标文件夹 ID：`1EC0L0S0kHn8UAIEY-nukXsTujPfX2ImG`（写在脚本里，不在网页里）。
**URL 为空时按钮完全不渲染** —— 这是这个功能的开关。

---

## 5. 已知限制与坑（接手前必读）

### 5.1 30 行上限
见 §4.2。**不要只改 `MAX_ITEMS`**。

### 5.2 数量/链接按位置对应
HTML 里第 N 个链接/数量配给第 N 个条目。**任何导致条目数变化的解析改动都会错位** ——
改解析器后必须确认条目数与购物车实际商品数一致。

### 5.3 价格是"复制那一刻"的快照
淘宝优惠会变（实测同一商品从 `平台加补后 ¥4.55` 变成 `店铺优惠后 ¥5.75`）。
**用户必须重新复制粘贴**才能拿到新价格 —— 曾因此产生"金额全错"的误报。
（可考虑加"解析时间"提示，见 §9）

### 5.4 淘宝界面文案是有限集合，见一个堵一个
已覆盖：`修改` `删除` `实付款` `距加入降` `平台加补后` `店铺优惠后` `补贴后` `券后价` `到手价`
`平台立减后` `超级立减…礼金直降满X减Y采购无忧` `信用卡支付` `不支持7天无理由退货极速退款` …
**遇到新的**：让用户把那一行原文发来，加进 `promoRe` / `CART_LABEL_RE`，然后跑 §7.1 回归。

### 5.5 2 字以下整行会被丢弃
"短行"判定要求 ≥3 字（2 字行落到 noise）。商品名极短（如"电机"）会丢，属于已知边缘情况。

### 5.6 两处"历史包袱"（体积/授权）
- **`tools/model/` 41.5 MB 模型权重已提交**：上游 sjvasquez/handwriting-synthesis **没有 LICENSE**
  （默认保留所有权利），本项目是**未授权再分发**，是维护者明确接受的风险。
  要撤销必须删文件 **并重写 git 历史**。
- **`media/how-to-2.mp4` 5 MB 视频**：同名文件会被浏览器缓存，所以换视频时**必须换文件名**。
- `.git` 已 51 MB：历史里的旧视频/旧模型都还在，clone 会全部下载。

### 5.7 队员不需要任何 Drive 权限（B 模式除外）
- 执行身份=**我**：队员零权限、零登录，文件夹可设"查看者"（更安全）
- 执行身份=**访问用户**（当前）：**文件夹必须"知道链接 → 编辑者"**，队员首次要授权

两个模式的要求正好相反，别混。

---

## 6. 开发环境与工具链的坑

### 6.1 macOS 环境事实
- 机器：Apple Silicon（arm64），macOS 26，系统 Python 3.9 + Homebrew Python 3.12/3.13/3.14
- **没有 ffmpeg、没有 Docker、没有 gh CLI**
- 装的是 **Microsoft Excel.app**（用户实际用 **WPS** 打开导出文件）
- 视频压缩：`avconvert` 预设压不动（`Preset960x540` 出来还有 55.6 MB，苹果预设按播放质量调），
  所以自写了 `tools/shrink_video.swift`（AVAssetWriter：缩放 + 降帧 + 显式码率 + faststart）：
  ```bash
  swift tools/shrink_video.swift 原始.mov media/how-to-2.mp4 1280 15 400
  #                                       输入         输出            宽  帧率 kbps
  ```

### 6.2 这个 shell 的 locale 是 C（会坑你）
- `pbcopy < 文件` 对**多字节内容静默失败**（返回 0 字节）。要用：
  ```bash
  osascript -e 'set the clipboard to (read POSIX file "/绝对路径/文件" as «class utf8»)'
  ```
- 比对剪贴板/输出里的中文前，先 `export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8`，
  否则 `pbpaste`/`diff` 会显示乱码，让你误判"内容坏了"

### 6.3 `grep index.html` 要避开 `TEMPLATE_B64`
那一行有 82,832 个 base64 字符。像 `grep -n "xlsx" index.html` 这种会把整行刷出来淹没输出。
用更具体的关键词，或 `grep -o`、或先排除该行。

### 6.4 jsdom 测试需要打桩
- 没有 canvas：`HTMLCanvasElement.prototype.getContext` 返回 `null` → 要 stub 一个假的 2D context
  和 `toDataURL`
- 没有 `fetch`：`window.fetch = globalThis.fetch`
- 没有 `scrollIntoView`：`Element.prototype.scrollIntoView = function(){}`
- `FileReader` 读不了 Node 的 Blob → 用 `blob.arrayBuffer()` 自己转 base64 打桩
- `form.submit()` 未实现 → `HTMLFormElement.prototype.submit` 打桩以捕获提交

### 6.5 Excel 自动化受限
用 AppleScript 让 Excel 打开导出的 xlsx 检查图形的做法**可行**（曾成功列出 27 个 shape 含
`signature.png`，证明无修复提示），但**让 Excel 导出 PDF 到 `/tmp` 会静默失败**（沙盒），
且 Excel 常驻时脚本会卡住 —— 别强杀用户的 Excel。

---

## 7. 怎么做验证（可直接复制的命令）

### 7.1 解析器回归（最重要的测试）

```bash
cat > /tmp/parse_test.js <<'JS'
const fs = require('fs');
const src = fs.readFileSync('/Users/chuntingli/Documents/cart_to_excel/index.html', 'utf8');
const slice = src.slice(src.indexOf('const CATEGORY_RULES'), src.indexOf('// === TEMPLATE'));
eval(slice + '\nvar MAX_ITEMS = 30;');          // MAX_ITEMS 在这个切片之外，必须补
const items = parseClipboardText(fs.readFileSync(process.argv[2], 'utf8'));
items.forEach(it => console.log('  ' + it.id + '  ¥' + String(it.price).padStart(7) +
  '  ' + it.name.slice(0, 34) + '  | spec=' + (it.spec || '(空)').slice(0, 26)));
console.log('  共 ' + items.length + ' 条，合计 ¥' + items.reduce((s,i)=>s+(i.price||0),0).toFixed(2)
  + '，缺价 ' + items.filter(i=>i.price===null).length + ' 条');
JS
node /tmp/parse_test.js 某个购物车文本.txt
```

**必查**：条目数是否等于购物车实际商品数、缺价数是否为 0、合计是否与页面一致。

### 7.2 导出链路（jsdom + JSZip）

建临时目录 `npm install jsdom jszip`，然后参照 §6.4 打桩，
驱动：粘贴 → 填三项 → 画签名 → `exportExcel()` → 捕获 Blob → 解压校验：
`C3` / `H66` / `H74` 值、`xl/media/image3.png` 存在、`drawing1.xml` 锚点单元格与长宽比、
`unzip -t` 完整。

### 7.3 探测 Apps Script 端点的模式

```bash
URL="https://script.google.com/macros/s/..../exec"
curl -s -o /dev/null -D - --max-time 30 "$URL" | grep -i -E "^HTTP|^location"
```
- 返回 `302 → accounts.google.com/ServiceLogin` ⇒ **执行身份=访问用户**（curl 无法测 POST，只能浏览器测）
- 返回 `200` + `{"ok":true,...}` ⇒ **执行身份=我**（curl 可以完整测 POST）
- GET 是 `doGet()` 的健康检查；POST 需要 `token` / `filename` / `data`(base64) / 可选 `nonce`

### 7.4 页面整体冒烟
jsdom 加载 `index.html`（`runScripts:'dangerously'`）→ 派发 paste 事件 → 断言：
条目数、必填校验（未填时 Export 按钮 `disabled`）、`Save to Drive` 按钮存在性、
无 `window.onerror`。

---

## 8. 常见改动配方

| 想做什么 | 改哪里 |
|---|---|
| 新增促销词/界面标签 | `promoRe` / `shortPromoRe` / `CART_LABEL_RE`（§4.3），然后跑 §7.1 |
| 改导出文件名格式 | `workbookFilename()`（当前 `YYYYMMDD <Competition> order form.xlsx`） |
| 换写入的单元格 | `exportExcel()` 里的 `setCellXML(sheetXML, 'C3', …)` 等；**先核对模板标签** |
| 改签名大小 | `embedSignature()` 里的 `targetHeight`（英寸）与 `MAX_WIDTH` |
| 改签名笔宽 | `padPaint()` 里的 `PAD_W * 0.009` |
| 改必填项 | `missingRequiredFields()` |
| 改模板 | 编辑 `template.xlsx` → 跑 §4.1 的 base64 重生成脚本 |
| 换 Drive 端点 | 重新部署 Apps Script → 更新 `DRIVE_UPLOAD_URL`（+ `TOKEN` 两边同步） |
| 临时关闭 Drive 上传 | 把 `DRIVE_UPLOAD_URL` 置空 → 按钮消失 |
| 换教学视频 | 用 `shrink_video.swift` 压 → **改文件名**（避免缓存）→ 更新 `index.html` 里的 `<source>`/`poster` |

---

## 9. 待办与可继续开发的方向

1. **超 30 条自动拆成多份表格**（用户已明确选"暂不做"，但要 IA/TA 确认政策）
2. **文件名带学生姓名**（`… order form — Chan Tai Man.xlsx`）—— 零成本解决"谁交的"（B 模式已用 Google 原生归属解决）
3. **首次授权引导写进页面**（告诉队员会看到"未验证应用"要点高级→继续）
4. **把真实购物车文本固化成 fixtures**（现在每次都要用户重发文本才能回归）
5. **给解析器加"解析时间"提示**，避免"快照价格"被误当成 bug（§5.3）
6. **仓库瘦身**：把 `tools/model/`（41.5 MB）和视频移出 git 历史（需重写历史 + 强推）
7. **Drive 上传的失败态**：目前新标签页显示错误，原页面不知道结果（跨域限制）；
   可考虑在成功页放"返回工具"链接，或用 `postMessage`（但 Apps Script 的 iframe 沙盒里
   `window.top.opener` 不可靠，需实测）

---

## 10. 交接检查清单

接手后建议按顺序做这几件事：

- [ ] `git log --oneline | head -30` —— 读提交信息，每条都写了"为什么"（信息量比 diff 大）
- [ ] 打开 https://cart-to-excel.vercel.app ，粘一份购物车走完整流程（导出 + Save to Drive）
- [ ] 确认 §4.5 的部署设置仍是「访问用户 + 任何人」
- [ ] 确认 Drive 文件夹权限仍是「知道链接 → 编辑者」（B 模式的硬要求）
- [ ] 跑一次 §7.1 的解析器回归，确认条目数/缺价数/合计
- [ ] 用 §5.4 的清单核对：有没有新的淘宝文案没覆盖
- [ ] 记住三条最容易犯的错：**商品名阈值必须 >14**、**`包邮` 只能过滤短行**、
      **改解析器后必须确认条目数**（否则链接/数量整体错位）

---

## 附：用户的明确偏好（避免重复讨论）

| 议题 | 用户的选择 |
|---|---|
| 30 行上限 | 维持现状（超出的标 ⚠ 不导出），要扩容需先问 IA/TA |
| Drive 归属 | **要文件归上传者本人** → 用「执行身份：访问用户」（已实现） |
| 队员邮箱 | **不知道也不打算收集** → 任何"按邮箱加白名单"的方案都不适用 |
| 文件夹权限 | 保持「知道链接 → 编辑者」，接受"谁拿到链接都能删"的风险 |
| 模型授权风险 | 明确接受（41.5 MB 权重已提交进公开仓库） |
| 教学视频 | 放在仓库里（5 MB），暂不外链 |
| 沟通语言 | 中文 |
