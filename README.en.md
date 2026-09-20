# Cart to Excel — HKUST Robotics Team Order Form Generator

[中文](README.md) | **English**

Turn a Taobao/Tmall shopping cart into the order-form Excel (based on `template.xlsx`) in one paste.

Live: **https://tony12290427.github.io/cart-to-excel/**

## How to use

1. Open the page (the URL above, or double-click `index.html` locally).
   ⚠️ An internet connection is required: the page loads JSZip from a CDN.
2. Fill in **Competition Name** (goes to cell B3) and **Student Name** (goes to H66). Both are optional.
3. On the Taobao cart page, select all and copy: `Ctrl+A` → `Ctrl+C` (`Cmd` on Mac).
4. Back on this page, **click into the input box inside the dashed area first**, then press `Ctrl+V`.
   Use the keyboard shortcut: the page listens for the paste event, which carries both the plain-text
   and the HTML flavor. Pasting from the right-click menu can drop the HTML, losing the item links
   and quantities.
5. Once `Found N items | Total ¥…` appears, click **Review & Edit**.
   If it is followed by `| QTY from clipboard HTML`, the quantities were recovered from the HTML (see below).
6. Check and fix: item name, QTY, unit price, Type category, Link. `×` on the right deletes a row.
   Cells whose price could not be parsed are highlighted yellow and need to be filled in by hand.
7. Click **Export Excel** → downloads `OrderForm_YYYYMMDD.xlsx`.

## About quantities (important)

The cart quantity is a **form control** on Taobao, and browsers do not serialize form-control values
into the clipboard's **plain-text** flavor — so **a direct paste contains no quantity line at all**
(measured: 0 quantity tokens).

There are two ways to get the quantities:

1. **Automatic**: the page falls back to the **HTML flavor** of the same clipboard and reads the
   quantity from each row's `<input value="N">`. On success the result bar shows
   `QTY from clipboard HTML`. This depends on Taobao's current page structure and may need adjusting
   if they redesign the cart.
2. **Manual fallback**: paste into macOS Notes first, then copy from Notes. Notes receives the rich
   text, renders the number as real text, so pasting back yields standalone lines like `4` and `2`
   that the parser can use directly.

If the result bar shows no `QTY from clipboard HTML` and every row is 1, neither path worked —
go through Notes once.

## Parser rules (read this before changing the code)

Per-line classification order (`classifyLine` — the order matters):

| # | Classification | Notes |
|---|---|---|
| 1 | Blank line | |
| 2 | Price `¥25` / `¥29.6` | Half-width `¥` also accepted; cross-line prices are merged in `preprocessPrice` |
| 3 | Quantity: 1–4 plain digits | Checked before the shop rule, otherwise `100` becomes a shop name |
| 4 | Spec: `label：value` (label 2–6 chars) | Generic rule, covers 颜色分类/版本号/飞机种类/商品规格/尺寸… |
| 5 | Product name: longer than 10 chars and not a promo line | |
| 6 | Ambiguous short line (3–14 chars) | Decided by the **next meaningful line**: a product name follows ⇒ shop; otherwise ⇒ product (short-title protection) |
| 7 | Everything else is noise | Promo lines such as 退货/优惠后/满减 |

Short lines like `版本号：新版本V2.4` used to be misread as shop names, and the scan aborted at any
shop line, silently losing the price and spec. The scan now **only stops at the next product line**;
shop lines no longer interrupt it.

Other conventions:

- When a listing has several spec lines (版本号 + 颜色分类 + 尺寸), the one matching
  `颜色分类/商品规格/规格/型号/套餐` wins (`specRank`), because that is the variant actually bought.
- When a listing shows two prices (`店铺优惠后 ￥114 ￥135`), the **first** is used — the discounted
  price actually paid.
- Item links are assigned to items in the order they appear in the HTML (adding or missing an item
  can shift them; paste the link by hand if that happens).

## The exported Excel

- Built on `template.xlsx`, 30 item rows (rows 11–40), one item per row.
- `B3` = Competition Name, `H66` = Name of student.
- The SUMIF category subtotals in rows 42–60 and the Grand Total in row 61 are template formulas and
  recalculate when opened in Excel; a web preview may still show 0.
- Every row defaults to Status = `Pending Approval`, with HKD / USD columns set to 0.

## Known limitations

- **30 items maximum**: parsing stops at the 30th item; anything beyond is not written (the template
  only has 30 rows).
- **Depends on Taobao's page structure**: most visible in the HTML quantity fallback; a redesign may
  require adjusting `extractQuantitiesFromHTML`.
- **Links are positional**: they are extracted in document order and assigned to items in sequence;
  fix by hand if they end up misaligned.
- **Offline use**: download `jszip.min.js` locally and change the `<script src>`.
  Note that `xlsx.full.min.js` (SheetJS) is never called by any code and can be dropped, keeping JSZip only.

## Using a different URL: deploy to Vercel

A GitHub Pages URL always contains your GitHub username (`<username>.github.io/<repo>/`) and that
cannot be changed. To get a neutral URL, connect the repository to Vercel — the free tier is far more
than enough for a single page.

1. Sign in at https://vercel.com/signup with your GitHub account.
2. Open https://vercel.com/new and authorize Vercel to read your GitHub repositories
   (Install Vercel GitHub App — either this repository only or all of them).
3. Pick `cart-to-excel` from the Import Git Repository list → **Import**.
4. Configure the project as follows:
   - **Project Name**: `cart-to-excel` (determines `cart-to-excel.vercel.app`; pick another if taken)
   - **Framework Preset**: `Other`
   - **Root Directory**: `./`
   - **Build Command / Output Directory**: **leave Override off**, the defaults are correct
     — this is a single static file (the template is embedded in `index.html` as base64), there is no build step
5. Click **Deploy**; it takes about half a minute and yields something like `https://cart-to-excel.vercel.app`.
6. Pushing to `master` redeploys automatically. To change the address, use Project Settings → Domains
   (custom domain) or Settings → General (project name).

Notes:

- `vercel.app` can be slow or unreachable from mainland China (Vercel itself recommends a custom domain
  to improve access there); Hong Kong and the rest of the world are fine. If most of the team is in
  mainland China, attaching a custom domain in Vercel is the safer option.
- The Vercel Hobby (free) plan is for **non-commercial** use only; a student-team internal tool qualifies.
- `template.xlsx` and `README.md` are published and publicly downloadable along with the page, exactly
  as they are on GitHub Pages today.
- The existing GitHub Pages URL can stay live in parallel; the two do not conflict.

## Changing the template

`index.html` hard-codes the entire `template.xlsx` as base64 in the `TEMPLATE_B64` constant, so
**after editing `template.xlsx` you must regenerate that base64**, otherwise the page keeps using the
old template:

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

(The base64 in this repository currently matches `template.xlsx` — verified. Re-running the script
above produces no diff.)

Template layout: rows 9–10 are the header, rows 11–40 are items, rows 41–61 are the subtotals.
The category names in `G42:G60` must match the `CATEGORIES` array in `index.html` **exactly**,
otherwise every SUMIF subtotal will be 0.
