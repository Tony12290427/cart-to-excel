# Google Drive 新版上传配置

## 2026-10-23 已有订单导入与原文件更新

`drive-upload.js` 新增 Google Picker 选表、XLSX 下载 / 原生 Google 表格导出、同 ID 的 multipart `PATCH` 更新。继续只使用 `drive.file`，无需扩大 OAuth 范围，不修改已有生产来源或 key 的 API 限制。`order-import.js` 在浏览器解析并编辑原始工作簿；原文件名、位置和所有者不修改。

更新前比较 `version` 和 `modifiedTime`，若 Google 暴露 ETag 则附 `If-Match`；412、版本变化和无法确认的写入会要求重新导入，不自动重试。未暴露 ETag 时这是保存前的版本检查，不能保证两次检查之间恰好发生的并发写入也被原子阻止，协作编辑应协调。

Google 表格以 XLSX 往返更新，会替换整个文档内容，Google 专属功能可能丢失；UI 会在保存前提示。Excel 更新保留原 ZIP 中的其他工作表和非商品区域，签名替换为本次重新签名，变更条目回到 `Pending Approval`。

已有读取/写入传输桩、真实模板往返和页面集成测试；真实 Google Picker 授权、共享表编辑权限和同 ID 云端保存仍须现场验收。不要把本机文件测试称为真实 Drive 更新成功，也不要为测试把本地来源加回生产配置。

目标：用提交人的 Google 账号，把生成的 `.xlsx` 存进团队 `Order Form`；只申请非敏感的 `drive.file` 权限，完成公开发布和所需品牌验证后验收首次使用界面。

## 当前状态

- 用户于 2026-10-11 提供了原有 Apps Script 成功页，文件 `20261011 wheel leg element order form.xlsx` 已保存。Drive 元数据也确认它位于目标文件夹；所有者未从插件返回，仍需人工核对。
- 新版代码：`drive-upload.js`。公开配置：`drive-config.js`。隐私说明：`privacy.html`。
- 新版三个公开配置值已填入接入分支；专用 Google Cloud 项目已发布为正式版。真实首次授权、目标选择、测试表上传及个人归属均已通过；本次提交启用正式站点的新客户端。
- 自动测试只能验证实现；Google Cloud 发布、真实授权界面、首次选文件夹、上传及文件归属需要实际账号验收。不能把代码完成称为警告已经消除。

## 2026-10-11 Google Cloud 配置进度

- 已创建专用项目：`Cart to Order Form`。
- Project ID：`cart-to-order-form`；Project number：`115821368206`（从 Console 当前项目页面读取）。
- 用户已明确授权接受 Google API 服务条款和用户数据政策，并创建 Web OAuth client / 受限制的 Picker API key。
- Google Drive API、Google Picker API 均已启用。OAuth 数据访问仅保存 `drive.file`，敏感和受限范围为空。
- Web 客户端和受限制的浏览器 key 均已创建，值已读取用于配置；客户端 secret 不用于此实现，未保存。
- 隐私页面已上线并核验 HTTP 200；主页和隐私链接已保存，Google Console 已显示“正式版”。
- 本地真实首次流程从账号选择直接进入普通 `drive.file` 授权页，未出现“未经验证／不安全”屏幕。用户明确授权后，Google Picker 成功选中目标文件夹，并真实创建测试表；Google 返回的所有者为当前提交账号。
- 回读测试文件确认目标 parent ID、xlsx MIME 和 63,239 字节完整 ZIP；C3/H66/F11/H11 值及签名 PNG 均正确。
- Google 验证中心明确显示：因未请求任何敏感或受限范围，无需数据访问验证。品牌显示的验证属于另一项，当前没有宣称通过 Google 品牌审核。
- 已测试账号为维护者账号；尚未用另一个队员账号做首次流程验收。

## 1. 在同一个 Google Cloud 项目中准备

打开 [Google Cloud Console](https://console.cloud.google.com/apis/credentials)。可创建一个独立的 `cart-to-excel` 项目，便于与旧 Apps Script 的广泛权限隔离。

在 APIs & Services → Library 启用：

- Google Drive API
- Google Picker API

无需为这个网页启用其它产品或购买付费服务。若 Console 弹出首次使用条款，由账号本人阅读并接受。

## 2. Google Auth Platform

在 Branding / Audience / Data Access 配置：

| 字段 | 内容 |
|---|---|
| App name | Cart to Order Form |
| User support / developer email | 使用维护者的实际邮箱 |
| Audience | External；队员可使用各自的 Google 账号 |
| Scope | **仅** `https://www.googleapis.com/auth/drive.file` |
| Homepage | 正式站点主页，例如 `https://cart-to-excel.vercel.app` |
| Privacy policy | 同一正式域名上的 `/privacy.html` |

不要添加 `drive`、`drive.readonly` 或 `drive.metadata.readonly`，否则又引入较广的受限权限。代码也设了 `include_granted_scopes: false`。

公开给队员使用时，Audience 要发布到 **In production**；Testing 模式有测试用户限制与测试提示，不适合“不收集队员邮箱”的要求。如需额外验证品牌显示或上传徽标，按 Console 当前要求处理。此项目实际配置只有两个 authorized domains、没有徽标、仅 `drive.file`，已成功正式发布；验证中心显示无需数据访问验证。不能把这个结果说成“已通过 Google 品牌审核”，也不能把仅填写配置值当作实际无警告验收。

Google 品牌验证要求证明 authorized domain 的所有权。以 Console 要求为准，在 Search Console 验证对应站点。若托管子域无法满足其域名核验要求，需要使用团队或维护者拥有的域名；不要假装拥有 `vercel.app` 或 `github.io`。本仓库尚未添加站点验证文件，须拿到 Google 给出的实际验证内容后添加。

## 3. 创建 Web application OAuth client

Google Auth Platform → Clients → Create client → Web application。

Authorized JavaScript origins 是 **origin**，没有路径、没有末尾 `/`：

```text
https://cart-to-excel.vercel.app
https://tony12290427.github.io
http://localhost:8765
http://127.0.0.1:49530
```

如果改用自有域名，也把该 origin 加入。GitHub Pages 项目路径 `/cart-to-excel/` 不应写进 origin。使用 GIS token popup，无需 OAuth redirect URI，也无需客户端 secret。

复制 **Client ID** 到 `drive-config.js` 的 `clientId`。

## 4. 创建并限制 Picker API key

APIs & Services → Credentials → Create credentials → API key。

设置 Application restrictions → Websites，允许：

```text
https://cart-to-excel.vercel.app/*
https://tony12290427.github.io/*
http://localhost:8765/*
http://127.0.0.1:49530/*
https://docs.google.com/*
```

Picker 在 `docs.google.com` 的 iframe 中发请求，官方文档要求同时允许它。API restrictions → Restrict key → Google Picker API 和 Google Drive API。

复制这个受限制的浏览器 key 到 `apiKey`。它按设计是浏览器可见的；不要在这里使用后台 secret 或把 key 的 API 限制取消。

## 5. 项目编号与配置

IAM & Admin → Settings 或项目详情中找到 **Project number（纯数字）**，不是 project ID。OAuth client、Picker key 和 project number 必须属于同一项目。

```js
window.ORDER_FORM_DRIVE_CONFIG = {
  clientId: '实际的 ID.apps.googleusercontent.com',
  apiKey: '受限制的浏览器 Picker key',
  projectNumber: '实际的纯数字项目编号',
  folderId: '1EC0L0S0kHn8UAIEY-nukXsTujPfX2ImG',
  folderName: 'Order Form'
};
```

这些值不是访问令牌。不要保存 client secret、access token 或 refresh token。

## 6. 队员的操作

1. 填好 Competition Name / Student Name，签名、核对商品。
2. 点击 Save to Drive，选择自己的 Google 账号并授予所需文件权限。
3. 首次授权目标文件夹时，Google Picker 会出现：选择团队的 **Order Form**。工具会检查 ID，只接受上面的目标文件夹。
4. 如果 Picker 找不到文件夹，先通过网页的 Order Form folder 链接打开它，必要时在 Drive 中添加快捷方式，再重试选择。能否从“知道链接”的共享文件夹顺利首次选取，是必须现场验证的一项。
5. 原网页显示保存文件名、文件夹、Google 返回的所有者和打开链接。

访问令牌只留在当前页面内存中。页面刷新或令牌过期后可能再次需要选账号；不能承诺永久免登录。文件夹仍需给提交人编辑权限，Google Picker 不会替用户获得原本没有的共享权限。

当前实现拒绝 Shared drive 的目标文件夹，因为 Shared drive 的文件归组织，而用户要求个人持有。团队目前使用的共享 My Drive 文件夹可以继续使用。

重复提交只创建新文件，不覆盖或删除。Drive 允许同名文件并存；新版不尝试列举队友文件来计算 `(2)` 后缀。旧脚本的每日 50 次限制不适用于新版直接 API 上传。

## 7. 验收和回退

```sh
node --test tools/drive-upload.test.cjs
# 可选页面／真实 xlsx 集成检查：依赖只装到临时目录
npm install --prefix /tmp/cart-to-excel-check jsdom@27 jszip@3.10.1 --no-audit --no-fund
NODE_PATH=/tmp/cart-to-excel-check/node_modules node tools/order-form-smoke.cjs
python3 -m http.server 8765
```

浏览器打开 `http://localhost:8765`（需先在 Google OAuth origin 配好此地址）。检查：首次界面、正确文件夹、真实 `.xlsx` 内容、签名、所有者、正常取消及重名并存。至少再用一个未授权过的队员账号测试，确认正常授权流程没有“未经验证／不安全”警告。

清空 `clientId`、`apiKey` 和 `projectNumber` 三项即可回到现有 Apps Script；旧端点留在 `index.html`。它仍会显示原有授权警告。新版实测通过之前不要删除旧部署。

## 官方依据

- [Google Drive 权限范围](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [GIS token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Google Picker 配置与同项目要求](https://developers.google.com/workspace/drive/picker/guides/web-picker-sample)
- [品牌验证、域名与公开发布](https://developers.google.com/identity/verification/authentication-verification)
