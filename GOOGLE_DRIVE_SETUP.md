# Google Drive 新版上传配置

目标：用提交人的 Google 账号，把生成的 `.xlsx` 存进团队 `Order Form`；只申请非敏感的 `drive.file` 权限，完成公开发布和所需品牌验证后验收首次使用界面。

## 当前状态

- 用户于 2026-10-11 提供了原有 Apps Script 成功页，文件 `20261011 wheel leg element order form.xlsx` 已保存。Drive 元数据也确认它位于目标文件夹；所有者未从插件返回，仍需人工核对。
- 新版代码：`drive-upload.js`。公开配置：`drive-config.js`。隐私说明：`privacy.html`。
- 三个 Google 配置值尚为空，因此网页继续使用已跑通的旧 Apps Script。填入完整配置后网页优先使用新版；部分配置会禁用上传并显示未完成提示，避免误以为新版已经启用。
- 自动测试只能验证实现；Google Cloud 发布、真实授权界面、首次选文件夹、上传及文件归属需要实际账号验收。不能把代码完成称为警告已经消除。

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

公开给队员使用时，Audience 要发布到 **In production**；Testing 模式有测试用户限制与测试提示，不适合“不收集队员邮箱”的要求。若需显示正式应用名称/品牌，按 Console 完成 Verify Branding → Publish branding。`drive.file` 是非敏感权限，但并不免除品牌、域名等发布要求，也不能承诺随便填三个值就没有警告。

Google 品牌验证要求证明 authorized domain 的所有权。以 Console 要求为准，在 Search Console 验证对应站点。若托管子域无法满足其域名核验要求，需要使用团队或维护者拥有的域名；不要假装拥有 `vercel.app` 或 `github.io`。本仓库尚未添加站点验证文件，须拿到 Google 给出的实际验证内容后添加。

## 3. 创建 Web application OAuth client

Google Auth Platform → Clients → Create client → Web application。

Authorized JavaScript origins 是 **origin**，没有路径、没有末尾 `/`：

```text
https://cart-to-excel.vercel.app
https://tony12290427.github.io
http://localhost:8765
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
