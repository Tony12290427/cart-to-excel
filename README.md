# Cart to Excel — HKUST Robotics Team Order Form Generator

**中文** | [English](README.en.md)

把淘宝/天猫购物车的内容一键转成订购表 Excel（基于 `template.xlsx`）。

线上直接用：**https://tony12290427.github.io/cart-to-excel/**

## 怎么用

1. 打开页面（上面的网址，或本地双击 `index.html`）。
   ⚠️ 需要联网：页面从 CDN 加载 JSZip（只有导出那一步需要）。
2. 填 **Competition Name**（写进表格 **C3**）和 **Student Name**（写进 **H66**）。
3. 签名：在签名框里**用鼠标/触控板直接手写**，或点 **Upload image** 传真实签名照片，见下。
   ⚠️ **这三项都是必填**：没填全时 **Export Excel 按钮是灰的**，合计栏会用红字列出还缺什么。
4. 到淘宝购物车页面，**从第一个要买的商品头部开始往下拖选，一直选到最后一个商品的尾部**，
   然后 `Ctrl+C`（Mac 用 `Cmd+C`）。**不要用 `Ctrl+A` 全选** —— 全选会把结算面板等无关内容一起带进来。
5. 回到本页面，**先用鼠标点一下虚线框里的输入框**，再按键盘 `Ctrl+V`。
   必须用键盘粘贴：代码监听 paste 事件，会同时读取纯文本和 HTML 两份数据，
   右键菜单粘贴可能丢掉 HTML，商品链接和数量就没了。
6. 出现 `Found N items | Total ¥…` 后点 **Review & Edit**。
   如果后面跟着 `| QTY from clipboard HTML`，说明数量是从 HTML 里救回来的（见下）。
7. 核对／修改：商品名、QTY、单价、Type 分类、Link；最右 `×` 删行。
   单价没解析出来的格子会标黄，需要手填。改动**即时**反映在下方合计里。
   清单下面还有一个粘贴框：**可以随时继续粘贴新商品，会追加到清单末尾**。
8. 点 **Export Excel**（三项必填齐全后才会亮起）→ 下载 `YYYYMMDD <Competition Name> order form.xlsx`
   （例如 `20260628 Go-Kart Extra order form.xlsx`；Competition 留空时是 `20260628 order form.xlsx`）。

## 导入并修改已有订单

1. 点击 **Import from Google Drive / 从 Drive 导入**，登录自己的 Google 账号，并在 Google Picker 中选择已有 `.xlsx` 或 Google 表格。也可用 **Import Excel** 读取本机副本。
   若 Google 选择器空白，按 Esc 退出，展开 **粘贴链接导入**，粘贴表格分享链接。链接导入仍只读取此应用已有权限的文件；尚未授权的旧表需要先在 Picker 选择，或下载本机副本再导入，不扩大 Drive 权限。
2. 页面显示商品名称、数量、单价、币种、位置、分类和链接，并带入比赛及学生姓名。可以直接编辑、删除，点击 **+ Add item** 手动新增，或继续粘贴购物车追加商品。当前草稿被替换前会确认；读取失败或取消不会清除草稿。
3. 原表学生签名区域已有嵌入图片时，页面会提示**保留原签名，无需重新签名**，可直接点击 **Update original / 更新原表**。这也适用于在 Excel / Google 表格手动插入、并非本平台生成的签名图片。未找到签名图片时才要求手写或上传；主动填写新签名会替换原签名，清空签名板则恢复保留原签名。
4. 有编辑权限时更新同一个 Drive 文件，文件名、位置、所有者和链接不改动。**Save a copy to Drive** 另建副本；**Export Excel** 下载到本机；两种方式也会保留原签名。

保存前重新检查原文件版本与编辑权限。若别人已更新、文件被移除，或无法确认上次写入结果，要求重新导入，不自动重试覆盖。文件内容仅在浏览器内存中处理，沿用 `drive.file`，不申请整盘读取权限。

标准 Excel 的其他工作表、未编辑区域和图片保留。未提供新签名时，原签名图片、绘图和关系文件原样保留；签名按标准表格签名区域的位置识别，不依赖图片名、上传来源或平台记录，支持普通单单元格、双单元格及绝对位置图片锚点。图片识别不验证签名人身份。修改过的条目重新标为 `Pending Approval`，未改动条目保留原状态；修改比赛或学生姓名时全部条目重新待审批。CNY/HKD/USD 分别保留与合计，不换算币种。原生 Google 表格通过 XLSX 导出和重新导入更新内容，Google 专属功能（例如评论）可能不保留，保存确认框会明确提示。

当前支持标准 HKUST 表格、一个订单工作表、最多 30 项、文件不超过 5 MB、读取 XML 不超过 8 MB。多张订单表、单行多币种金额、无效数量或超限会提示，不能截断后覆盖原表。

本机预览：`node tools/preview-order-form.cjs`，打开输出的地址。这个预览只提供网页公开资源，不提供后台数据库或 `.env`。生产 Google 客户端与 Picker key 不允许本地来源；本机只测试编辑/导出，真实 Drive 流程在已配置的正式来源或独立开发配置上验收，不放宽生产限制。

开发检查（Node 22.22.2+）：

```sh
npm install --prefix /tmp/order-form-test-deps --no-save jszip@3.10.2 jsdom@30.1.2
NODE_PATH=/tmp/order-form-test-deps/node_modules node --test tools/drive-upload.test.cjs tools/drive-import.test.cjs tools/order-import.test.cjs
NODE_PATH=/tmp/order-form-test-deps/node_modules node tools/order-form-smoke.cjs
```

## 关于数量（重要）

淘宝购物车的数量是个**表单输入框**，浏览器复制选区时不会把表单控件的值写进剪贴板的
**纯文本**，所以**直接粘贴时文本里一个数量行都没有**（实测：数量 token = 0 个）。

现在有两种拿到数量的方式：

1. **自动**：页面会转而解析同一份剪贴板的 **HTML 富文本**，从每个商品行里的
   `<input value="N">` 取数量。成功时结果栏会显示 `QTY from clipboard HTML`。
   这个办法依赖淘宝当前的页面结构，淘宝改版后可能需要跟着调。
2. **手动兜底**：先粘到 macOS 备忘录，再从备忘录复制一次。备忘录走的是富文本，
   会把数量渲染成真文字，于是粘贴出来就带 `4`、`2` 这样的独立行，解析器直接用这些行。

如果结果栏既没有 `QTY from clipboard HTML`、表格里又全是 1，说明两条路都没拿到，
用备忘录绕一下即可。

## 签名

在页面顶部的 Signature 栏里**直接用鼠标或触控板手写**签名（也可以用触屏/手写笔）：

- 在虚线框里按住拖动即可书写，线条会自动平滑
- **Undo** 撤销最后一笔，**Clear** 全部清空
- **Upload image** 也可以改用真实签名的照片/扫描件（自动去白底、裁到墨迹）
- 导出时只截取**有笔迹的部分**，所以图片里没有多余空白，也不会被拉变形

签名会作为图片写进 `Sign of student` 那一栏（H70 起），导出时自动嵌入 xlsx，
不需要手动往表格里插图片。

> 早期版本用的是"输入名字 → 字体生成签名"（Dancing Script / Great Vibes）。
> 那个方案已经移除，因为手写永远比字体更像本人签名；顺带也去掉了 Google Fonts 依赖，
> 现在页面除了 JSZip 之外不需要任何外部资源。
> 如果你想用 AI 生成手写签名，`tools/neural_signature.py` 仍然可用：在本地生成 PNG，
> 再用 **Upload image** 传进来即可。

## 解析规则速查（改代码前先看这里）

逐行判定顺序（`classifyLine`，顺序不能随便换）：

| 顺序 | 判定 | 说明 |
|---|---|---|
| 1 | 空行 | |
| 2 | 价格 `¥25` / `¥29.6` | 也支持半角 `¥`；跨行价格已在 `preprocessPrice` 合并 |
| 3 | 数量：纯数字 1–4 位 | 放在店铺判定之前，否则 100 会被当成店铺名 |
| 4 | 规格：`标签：值`（标签 2–6 字） | 通用规则，覆盖 颜色分类/版本号/飞机种类/商品规格/尺寸… |
| 5 | 商品名：长度 > 14 且非促销行 | 阈值必须 >14：店铺名最长 14 字（`金茂五金机械自动化企业店` 是 11 字），否则店铺名会被当成商品 |
| 6 | 模糊短行（3–14 字） | 由**下一有效行**决定：后面是商品名 ⇒ 店铺；否则 ⇒ 商品（短标题保护） |
| 7 | 其余为噪音 | 退货/优惠后/满减等促销行 |

> ⚠️ 促销词的匹配范围要小心：像 **`包邮`** 这种词，卖家会直接写在**商品标题开头**
> （`包邮2倍热缩管绝缘套管…`），如果一律当促销行过滤，整条商品就会消失、上面的店铺名反而顶上来当商品。
> 所以过滤词分两组：**折扣/售后类**（退货、立减、直降、礼金、满X减Y…）任何长度都过滤；
> **可能出现在标题里的**（包邮、信用卡、支付）只过滤短行；标题开头的 `包邮` 还会被去掉。

版本号类短行以前会被误判成店铺名，而扫描遇到店铺行就中断，导致价格和规格静默丢失；
现在扫描**只在遇到下一个商品行时中断**，店铺行不再打断。

其它约定：

- 同一商品有多个规格行时（版本号 + 颜色分类 + 尺寸），保留 `颜色分类/商品规格/规格/型号/套餐`
  里的那个（`specRank`），因为它才是真正买到的型号。
- 同一个 listing 出现两个价格（`店铺优惠后 ￥114 ￥135`）时，取**第一个**，即优惠后实付价。
- 商品链接按 HTML 里出现的顺序依次配给商品（新增/漏掉商品时可能错位，手工贴一下即可）。

## 输出的 Excel

- 用 `template.xlsx` 做底，30 个商品行（第 11–40 行），一个商品一行。
- `C3` = Competition Name（A3 是 `Competition:` 标签，这套表的值都填在 C 列，如 C4 = Intelligent Racing），
  `H66` = Name of student（G66 是标签），`H74` = Date（G74 是标签，填导出当天日期）。
- 签名图片以 **H70** 为左上角、按**图片自身长宽比**定尺寸（默认高 0.55 英寸，最长 3.4 英寸），
  所以不会被拉扁；名字越长签名越宽。
- 第 42–60 行的 SUMIF 分类小计、第 61 行 Grand Total 是模板自带公式，打开 Excel 会自动重算；
  网页预览或没重算时可能显示 0。
- 每行默认 Status = `Pending Approval`，HKD / USD 列写 0。

## 已知限制

- **表格只能放 30 个商品**（模板第 11–40 行）。继续粘贴可以无限追加到清单，
  但超过 30 条的部分会在表格里变灰并标 ⚠，合计栏提示超出多少，**只有前 30 条会写进表格**。
  （单次粘贴仍最多解析 30 条。）
  **为什么不能直接把 30 改成 60**：模板第 11–40 行的序号 `1…30` 是预先印好的，而且所有小计公式
  都写死了行范围（`SUMIF($G$10:$G$40, …)`、`SUM(H11:H40)`、`SUMIF($K$10:$K$40, …)`）——
  多插的行不会被任何小计统计，表格会显示**错误金额**。扩容必须同时改公式、样式和签名/日期行位置，
  属于改动官方表格结构，所以目前不做。
- **依赖淘宝页面结构**：数量走 HTML 兜底那条路时尤其明显，淘宝改版可能需要调整
  `extractQuantitiesFromHTML`。
- **链接按顺序对应**：从 HTML 里按出现顺序抽取再依次配给商品，顺序错位就手工贴。
- **离线使用**：把 `jszip.min.js` 下载到本地并改 `<script src>`。
  另外 `xlsx.full.min.js`（SheetJS）实际上没被任何代码调用，可以删掉，只留 JSZip。

## 换地址：部署到 Vercel

GitHub Pages 的地址永远带 GitHub 用户名（`<用户名>.github.io/<仓库名>/`），这个没法改；
想换成中性地址就把仓库接到 Vercel，免费额度对这一个页面绰绰有余。

1. 用 GitHub 账号登录 https://vercel.com/signup
2. 打开 https://vercel.com/new ，授权 Vercel 读取 GitHub 仓库
   （Install Vercel GitHub App，选这个仓库或全部仓库都行）
3. 在 Import Git Repository 列表里选 `cart-to-excel` → **Import**
4. Configure Project 照这样填：
   - **Project Name**：`cart-to-excel`（决定地址 `cart-to-excel.vercel.app`，被占用就换一个）
   - **Framework Preset**：`Other`
   - **Root Directory**：`./`
   - **Build Command / Output Directory**：**不要打开 Override**，留默认即可
     —— 本项目是纯静态单文件（模板已 base64 内嵌在 `index.html` 里），没有构建步骤
5. 点 **Deploy**，约半分钟出结果，地址形如 `https://cart-to-excel.vercel.app`
6. 以后往 `master` push 会自动重新部署；要改地址在 Project Settings → Domains（绑自定义域名）
   或 Settings → General（改 Project Name）

注意事项：

- `vercel.app` 在中国大陆可能访问慢或不通（Vercel 官方也建议用自定义域名改善大陆访问）；
  香港／海外正常。队友主要在大陆的话，之后在 Vercel 里绑自己的域名更稳。
- Vercel Hobby（免费）计划仅限**非商业**用途，社团内部工具符合。
- 部署后 `template.xlsx`、`README.md` 也会一并被公开访问，与现在 GitHub Pages 的情况相同。
- 原来的 GitHub Pages 地址可以留着并行使用，两者不冲突。

## 神经网络签名（离线生成，可选）

除了页面上的字体生成，还可以用 Graves 手写 RNN（[sjvasquez/handwriting-synthesis](https://github.com/sjvasquez/handwriting-synthesis)）
生成真正的神经网络手写签名：

```bash
python3 -m venv .venv-neural
.venv-neural/bin/pip install tensorflow pillow
.venv-neural/bin/python tools/neural_signature.py "Tony Chan" -o signature.png
```

再把 `signature.png` 用页面上的 **Upload image** 传进去即可。参数：`--bias`（0.5–1.5，越大越工整）、
`--seed`（固定随机数，签名可复现）、`--width`（笔宽）、`--steps`（采样步数，默认每字符 40 步）。

**实现说明**：模型是 2018 年的 TF1 计算图，但 `.meta` 文件里带着完整图定义，所以**不用装 TF1、
也不用移植**，现代 TensorFlow（arm64 原生）直接恢复运行即可。权重随仓库提供（`tools/model/`，
共 41.5 MB：`.meta` 1.6 MB + `.index` 1 KB + `.data-00000-of-00001` 41.6 MB），文件缺失时脚本会自动
从上游重新下载。

两个限制：

- **只能用非 priming 分支**。原图的风格 priming 走 `tf.cond`，在 TF2 下未被选中的分支会以
  `TensorArray has size zero` 报错；而且仓库的 `styles/` 与它自己的 `demo.py` 已经不一致
  （demo 读 `style-9-strokes.npy`，仓库里只有 `style-1.npy`／`style-2.npy`）。所以输出是"通用手写体"，
  每次都不一样，多换几个 `--seed`／`--bias` 挑一个满意的。
- ⚠️ **授权**：上游仓库**没有 LICENSE 文件**，代码与 41.5 MB 权重默认保留所有权利。本仓库按维护者
  要求把该 checkpoint 一并提交（`tools/model/`），属于未授权再分发——如果作者提出异议，需要删除文件
  **并重写 git 历史**才能彻底移除。若要进一步把模型嵌进网页公开放出去，建议先取得作者授权。

## 使用说明视频

页面顶部有一个可折叠的 **📖 How to use** 面板，里面是 5 步说明 + 一段 2 分钟的演示录屏
（`media/how-to.mp4`，带封面图）。

**视频是怎么压的**：原始录屏 105.7 秒、2590×1544 @ 39fps、11.5 Mbps，共 **144 MB**。
macOS 自带的 `avconvert` 预设压不动（`Preset960x540` 出来还有 55.6 MB，因为苹果预设是按播放质量
而不是网页体积调的），所以用 `tools/shrink_video.swift` 直接调 AVAssetWriter 编码：

```bash
swift tools/shrink_video.swift 原始录屏.mov media/how-to.mp4 1280 15 400
#                                       输入            输出        宽  帧率 kbps
```

缩放 + 降帧 + 显式码率，**144 MB → 5.4 MB**（缩小 27 倍），时长和文字清晰度都保留，
并开启 faststart（moov 前置，可边下边播）。重新录屏后照这条命令再跑一次即可。

**如果不想让视频占仓库体积**，可以把它放到别处再改一行：

| 放哪 | 怎么改 |
|---|---|
| YouTube / Bilibili（不占仓库、可设不公开） | 把 `<video>…</video>` 整块换成 `<iframe src="https://www.youtube.com/embed/视频ID" allowfullscreen></iframe>` |
| GitHub Release 附件（不占 git 历史，约 1 分钟） | 建一个 Release 把 `how-to.mp4` 拖进去，然后把 `<source src="media/how-to.mp4">` 换成附件地址 |
| 自己的对象存储 / CDN | 同上，直接换成直链 |

> 注意：`media/how-to.mp4` 一旦提交就永久留在 git 历史里，换外链也只会让**以后**的 clone 变小，
> 已提交的那 5.4 MB 仍在历史中（要彻底去掉得重写历史）。

## 直接存到 Google Drive

`Save to Drive` 可以用提交人的 Google 账号，把完整订购表存进团队 **Order Form** 文件夹。

新版使用 Google 官方登录、文件夹选择器和 Drive API，只申请 **`drive.file` 非敏感权限**。
首次需要选择自己的账号，并在提示时选择团队的 Order Form 文件夹。上传成功后，原页面显示文件名、文件夹、所有者及打开链接。工具只创建新文件，重复提交会并存；不会覆盖或删除队友的表格。

**配置步骤见 [GOOGLE_DRIVE_SETUP.md](GOOGLE_DRIVE_SETUP.md)**：需同一个 Google Cloud 项目的 Web OAuth Client ID、受限制的 Picker API key 和项目编号，填入 `drive-config.js`。公开发布时还需完成 Google 要求的品牌／域名配置；不能仅凭代码修改承诺不出现警告。

**迁移状态（2026-10-11）**：专用 Google Cloud 项目已配置为正式版，新版公开配置值已接入开发分支。真实首次账号选择后直接显示普通 `drive.file` 授权页，未出现“未经验证／不安全”屏幕。Google Picker、真实测试表上传和当前账号个人归属均已通过，下载回读的 Excel 及签名正确；新版配置已启用。另一个队员账号的首次使用仍需现场核对。

- 上传者必须具有目标文件夹编辑权限；现有“知道链接 → 编辑者”设置可继续使用，Google Picker 本身不授予共享权限。
- 使用共享的 My Drive 文件夹时文件由上传账号创建；Shared drive 中的文件归组织，新版会拒绝这种目标。
- 新版访问令牌只留在当前页面内存中；刷新或过期后可能需要再次选择账号。`Switch Google account` 可切换提交账号。
- 同名文件在 Drive 中可以并存；新版不列举队友文件来计算 `(2)` 后缀。
- 上传遇到网络中断时，先在文件夹检查是否已经生成，避免重复提交。
- `clientId`、`apiKey`、`projectNumber` 都留空时使用 `index.html` 中的旧端点；部分填写会阻止上传并提示设置未完成。
- [隐私说明](privacy.html) 描述表格、签名、Google 授权与共享方式。

旧脚本保留于 `tools/drive-upload.gs`，执行身份需为“访问 Web 应用的用户”。其 TOKEN 只是公开的校验字段；代码只创建文件的行为限制不等于 Google 把授权权限限制在一个文件夹。旧脚本有文件名、ZIP 标头／工作簿路径及每日次数检查，这些简单检查不能证明任意传入内容安全，也不适用于新版直接 API 上传。

## 改模板

`index.html` 把整个 `template.xlsx` 以 base64 硬编码在 `TEMPLATE_B64` 常量里，
**改了 `template.xlsx` 必须重新生成这段 base64**，否则页面还是用旧模板：

```bash
python3 - <<'PY'
import base64, re
b64 = base64.b64encode(open('template.xlsx','rb').read()).decode()
s = open('index.html', encoding='utf-8').read()
s = re.sub(r'const TEMPLATE_B64 = "[^"]*"', 'const TEMPLATE_B64 = "' + b64 + '"', s, count=1)
open('index.html', 'w', encoding='utf-8').write(s)
print('ok', len(b64))
PY
```

（当前仓库里这段 base64 与 `template.xlsx` 一致，已校验；上面脚本重复执行不会产生 diff。）

模板结构：第 9–10 行表头，第 11–40 行商品，第 41–61 行小计。
`G42:G60` 的分类名必须和 `index.html` 里 `CATEGORIES` 数组**完全一致**，
否则 SUMIF 小计全部为 0。
