# Cart to Excel — HKUST Robotics Team Order Form Generator

[中文](README.md) | **English**

Turn a Taobao/Tmall shopping cart into the order-form Excel (based on `template.xlsx`) in one paste.

Live: **https://tony12290427.github.io/cart-to-excel/**

## How to use

1. Open the page (the URL above, or double-click `index.html` locally).
   ⚠️ An internet connection is required: the page loads JSZip from a CDN (needed
   only for the export step).
2. Fill in **Competition Name** (goes to cell **C3**) and **Student Name** (goes to **H66**).
   Both are optional.
3. (Optional) Add a signature: **draw it with the mouse or trackpad** in the signature box,
   or press **Upload image** to use a picture of your real signature — see the next section.
4. On the Taobao cart page, **drag-select from the top of the first item you want down to the end of
   the last one**, then press `Ctrl+C` (`Cmd+C` on Mac). **Do not use `Ctrl+A`** — selecting the whole
   page drags in the settlement panel and other parts the parser has no use for.
5. Back on this page, **click into the input box inside the dashed area first**, then press `Ctrl+V`.
   Use the keyboard shortcut: the page listens for the paste event, which carries both the plain-text
   and the HTML flavor. Pasting from the right-click menu can drop the HTML, losing the item links
   and quantities.
6. Once `Found N items | Total ¥…` appears, click **Review & Edit**.
   If it is followed by `| QTY from clipboard HTML`, the quantities were recovered from the HTML (see below).
7. Check and fix: item name, QTY, unit price, Type category, Link. `×` on the right deletes a row.
   Cells whose price could not be parsed are highlighted yellow and need to be filled in by hand.
   Edits update the running total **immediately**, and the paste box below the table lets you
   **paste more items at any time — they are appended to the end of the list**.
8. Click **Export Excel** → downloads `YYYYMMDD <Competition Name> order form.xlsx`
   (e.g. `20260628 Go-Kart Extra order form.xlsx`; with Competition blank it is
   `20260628 order form.xlsx`).

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

## Signature (optional)

Sign **directly with the mouse or trackpad** in the Signature row at the top of
the page (touch and stylus work too):

- Press and drag inside the dashed box to write; the ink is smoothed as you go
- **Undo** removes the last stroke, **Clear** empties the pad
- **Upload image** switches to a photo or scan of a real signature instead (the
  white background is made transparent and the image is cropped to the ink)
- Only the inked area is exported, so the picture carries no dead space and is
  never stretched

The signature is written into the `Sign of student` area (from H70) as an image
on export — there is nothing to paste into Excel by hand.

> Earlier versions generated the signature from a typed name using a handwriting
> font (Dancing Script / Great Vibes). That is gone: hand-writing looks like the
> person, a font never does. It also removed the Google Fonts dependency, so the
> page now needs no external resource other than JSZip. If you do want a
> machine-generated hand, `tools/neural_signature.py` still works — generate a
> PNG locally and bring it in with **Upload image**.

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
- `C3` = Competition Name (A3 holds the `Competition:` label; this form puts every value
  in column C, e.g. C4 = Intelligent Racing), `H66` = Name of student (labelled in G66),
  `H74` = Date (labelled in G74, filled with the export date).
- The signature image is anchored at **H70** and sized from its **own aspect ratio**
  (0.55 in tall by default, at most 3.4 in wide), so it is never stretched; a longer
  name simply makes it wider.
- The SUMIF category subtotals in rows 42–60 and the Grand Total in row 61 are template formulas and
  recalculate when opened in Excel; a web preview may still show 0.
- Every row defaults to Status = `Pending Approval`, with HKD / USD columns set to 0.

## Known limitations

- **The form holds 30 items** (template rows 11-40). Pasting again appends without limit, but rows
  past 30 are greyed out and marked ⚠, the summary reports how many are over, and **only the first
  30 are written to the form**. (A single paste still parses at most 30 items.)
  **Why 30 cannot simply be raised to 60**: rows 11-40 carry pre-printed numbers `1…30`, and every
  subtotal formula hard-codes its range (`SUMIF($G$10:$G$40, …)`, `SUM(H11:H40)`,
  `SUMIF($K$10:$K$40, …)`). Inserted rows would be counted by none of them, so the form would show
  **wrong amounts**. Growing it means editing formulas, styles and the signature/date rows too —
  i.e. changing the structure of an official form, which is why it is left alone.
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

## Neural signature (offline, optional)

Besides the in-page font generator you can produce a genuine neural-network
handwriting sample with the Graves handwriting RNN
([sjvasquez/handwriting-synthesis](https://github.com/sjvasquez/handwriting-synthesis)):

```bash
python3 -m venv .venv-neural
.venv-neural/bin/pip install tensorflow pillow
.venv-neural/bin/python tools/neural_signature.py "Tony Chan" -o signature.png
```

Then drop `signature.png` into the page with **Upload image**. Options: `--bias`
(0.5–1.5, higher is tidier), `--seed` (fix the RNG for a repeatable signature),
`--width` (pen width), `--steps` (sampling steps, 40 per character by default).

**How it works**: the model is a 2018 TF1 graph, but the `.meta` file carries the
whole graph definition, so no TF1 install and no porting is required — modern
TensorFlow restores and runs it natively on arm64. The checkpoint ships with the
repository in `tools/model/` (41.5 MB total: `.meta` 1.6 MB, `.index` 1 KB,
`.data-00000-of-00001` 41.6 MB); if those files are missing the script downloads
them from upstream again.

Two limitations:

- **Only the non-primed branch is usable.** Upstream's style priming goes through
  `tf.cond`, and under TF2 the untaken branch dies with `TensorArray has size
  zero`; upstream's `styles/` also no longer matches its own `demo.py` (the demo
  reads `style-9-strokes.npy`, the repo ships `style-1.npy` / `style-2.npy`).
  The result is therefore generic handwriting that differs on every run — try a
  few `--seed` / `--bias` values and keep the one you like.
- ⚠️ **Licensing**: upstream has **no LICENSE file**, so its code and the 41.5 MB
  checkpoint are all rights reserved by default. This repository commits that
  checkpoint (`tools/model/`) at the maintainer's request, which is an
  unauthorised redistribution — if the author objects, removing it means deleting
  the files **and rewriting git history**. Get the author's permission before
  going further, e.g. embedding the model in the published web page.

## Walkthrough video

A collapsible **📖 How to use** panel sits at the top of the page: five steps plus a
two-minute screen recording (`media/how-to.mp4`, with a poster frame).

**How it was compressed**: the raw recording is 105.7 s, 2590x1544 @ 39 fps,
11.5 Mbps — **144 MB**. macOS's own `avconvert` cannot get there (`Preset960x540`
still weighs 55.6 MB, because Apple's presets target playback quality rather than
web size), so `tools/shrink_video.swift` drives AVAssetWriter directly:

```bash
swift tools/shrink_video.swift raw-recording.mov media/how-to.mp4 1280 15 400
#                                      input             output       width fps kbps
```

Downscale + drop the frame rate + set an explicit bitrate took **144 MB to 5.4 MB**
(27x smaller) while keeping the full duration and legible text, with faststart
enabled (moov first, so it plays while still downloading). Re-run that command
after recording a new one.

**To keep the video out of the repository instead**, change one line:

| Where | What to change |
|---|---|
| YouTube / Bilibili (no repo weight, can be unlisted) | replace the whole `<video>…</video>` block with `<iframe src="https://www.youtube.com/embed/VIDEO_ID" allowfullscreen></iframe>` |
| GitHub Release asset (no git history, takes a minute) | create a Release, drag `how-to.mp4` in, then point `<source src="...">` at the asset URL |
| Your own bucket / CDN | same — just use the direct URL |

> Note: once `media/how-to.mp4` is committed it stays in git history forever.
> Switching to an external URL only makes *future* clones smaller.

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
