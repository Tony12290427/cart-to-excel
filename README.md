# Cart to Excel — HKUST Robotics Team Order Form Generator

把淘宝/天猫购物车的内容一键转成订购表 Excel（基于 `template.xlsx`）。

线上直接用：**https://tony12290427.github.io/cart-to-excel/**

## 怎么用

1. 打开页面（上面的网址，或本地双击 `index.html`）。
   ⚠️ 需要联网：页面从 CDN 加载 JSZip。
2. 填 **Competition Name**（写进表格 B3）和 **Student Name**（写进 H66）。可以留空。
3. 到淘宝购物车页面全选复制：`Ctrl+A` → `Ctrl+C`（Mac 用 `Cmd`）。
4. 回到本页面，**先用鼠标点一下虚线框里的输入框**，再按键盘 `Ctrl+V`。
   必须用键盘粘贴：代码监听 paste 事件，会同时读取纯文本和 HTML 两份数据，
   右键菜单粘贴可能丢掉 HTML，商品链接和数量就没了。
5. 出现 `Found N items | Total ¥…` 后点 **Review & Edit**。
   如果后面跟着 `| QTY from clipboard HTML`，说明数量是从 HTML 里救回来的（见下）。
6. 核对／修改：商品名、QTY、单价、Type 分类、Link；最右 `×` 删行。
   单价没解析出来的格子会标黄，需要手填。
7. 点 **Export Excel** → 下载 `OrderForm_YYYYMMDD.xlsx`。

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

## 解析规则速查（改代码前先看这里）

逐行判定顺序（`classifyLine`，顺序不能随便换）：

| 顺序 | 判定 | 说明 |
|---|---|---|
| 1 | 空行 | |
| 2 | 价格 `¥25` / `¥29.6` | 也支持半角 `¥`；跨行价格已在 `preprocessPrice` 合并 |
| 3 | 数量：纯数字 1–4 位 | 放在店铺判定之前，否则 100 会被当成店铺名 |
| 4 | 规格：`标签：值`（标签 2–6 字） | 通用规则，覆盖 颜色分类/版本号/飞机种类/商品规格/尺寸… |
| 5 | 商品名：长度 > 10 且非促销行 | |
| 6 | 模糊短行（3–14 字） | 由**下一有效行**决定：后面是商品名 ⇒ 店铺；否则 ⇒ 商品（短标题保护） |
| 7 | 其余为噪音 | 退货/优惠后/满减等促销行 |

版本号类短行以前会被误判成店铺名，而扫描遇到店铺行就中断，导致价格和规格静默丢失；
现在扫描**只在遇到下一个商品行时中断**，店铺行不再打断。

其它约定：

- 同一商品有多个规格行时（版本号 + 颜色分类 + 尺寸），保留 `颜色分类/商品规格/规格/型号/套餐`
  里的那个（`specRank`），因为它才是真正买到的型号。
- 同一个 listing 出现两个价格（`店铺优惠后 ￥114 ￥135`）时，取**第一个**，即优惠后实付价。
- 商品链接按 HTML 里出现的顺序依次配给商品（新增/漏掉商品时可能错位，手工贴一下即可）。

## 输出的 Excel

- 用 `template.xlsx` 做底，30 个商品行（第 11–40 行），一个商品一行。
- `B3` = Competition Name，`H66` = Name of student。
- 第 42–60 行的 SUMIF 分类小计、第 61 行 Grand Total 是模板自带公式，打开 Excel 会自动重算；
  网页预览或没重算时可能显示 0。
- 每行默认 Status = `Pending Approval`，HKD / USD 列写 0。

## 已知限制

- **最多 30 个商品**：解析到第 30 个就停，第 31 个起不会写进表（模板只有 30 行）。
- **依赖淘宝页面结构**：数量走 HTML 兜底那条路时尤其明显，淘宝改版可能需要调整
  `extractQuantitiesFromHTML`。
- **链接按顺序对应**：从 HTML 里按出现顺序抽取再依次配给商品，顺序错位就手工贴。
- **离线使用**：把 `jszip.min.js` 下载到本地并改 `<script src>`。
  另外 `xlsx.full.min.js`（SheetJS）实际上没被任何代码调用，可以删掉，只留 JSZip。

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
