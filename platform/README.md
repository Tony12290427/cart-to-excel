# Order Form 订单管理第一版

管理方记录已下单数量及送到学校的批次，团队学生领取后按商品和数量验收。原始 Excel / Google 表格继续保存在原来的 Drive 文件夹，状态及操作记录保存在独立 SQLite 数据库。

## 当前验收状态

- 本机演示完成：确认纳入、部分下单、补齐下单、第一批到校、学生甲部分验收、第二批到校、学生乙补齐验收、自动显示已到齐。
- 使用真实 Drive Excel 与 Google 表格的 XLSX 导出验证导入器，分别识别 8 项和 7 项，数量通过校验。样本只做读取和解析，没有写入真实订单进度。
- 自动化测试覆盖分页同步、两种表格 XML、权限、CSRF、重复/并发提交、数量上限、数据库重开、异常与更正、原表变更及丢失。
- 专用服务账号已创建并直接共享为文件夹查看者，本机凭据在仓库外私有目录。后台首轮扫描 186 个文件；定时同步随后又发现 2 个候选表。2026-10-14 13:15（香港时间）扫描共 188 个文件，登记 184 个表格候选，其中 169 个解析为标准商品清单，15 个缺少数量、含多张订单表或不符合格式，保留待核实。所有真实订单进度仍待核实，未重复导入。
- 独立 `Order Platform Local` 登录客户端已创建，只允许 `http://127.0.0.1:8787`。实际 Google 登录及后台 ID token 验证通过，维护者账号已设为首位管理员。客户端 secret 未用于实现、未保存。

## 本机预览

需要 Node.js 22.22.2 或更新版本。当前使用 Node 内置 SQLite，22.x 会显示实验功能提示。

```sh
cd /Users/chuntingli/Documents/cart_to_excel/platform
npm ci
npm run demo
```

演示打开 `http://127.0.0.1:8788`。可切换管理方、两名学生和管理员，演示数据全是虚构内容。演示数据库为 `data/demo.sqlite`；真实模式 `npm start` 使用 `http://127.0.0.1:8787` 和 `data/orders.sqlite`。两者使用不同会话 Cookie，避免身份互相覆盖。演示模式只能绑定本机地址，不能在正式模式启用，不能连接实际订单数据库。

## 功能与数量含义

1. 后台启动时同步，并每 300 秒轮询一次固定 Drive 文件夹；管理方也可点“立即同步 Drive”。完整读取分页后才判定文件移出，失败不会删除订单。
   第一版同步该文件夹的直接子表格，不递归读取“Closed Order Form”等归档子文件夹。
2. 每份新发现的标准表进入“待核实”。管理方确认纳入、排除非订单或归档历史订单。预算、读取失败及非标准文件显示原因，不能冒充成功导入。
3. 已下单数量是每项商品的**累计总数**。可一键全部下单，或保留个别项目未下单。
4. 快递批次可无单号；管理方确认送到学校。每份订单可有多批，第一版按订单登记批次，不自动对接快递公司的物流数据，也不推断批次内应有哪几项。
5. 学生填写本次**新收到且检查合格**的数量，平台累计每个 item，并将数量关联到该批次和实际验收人。损坏或错货不计入合格数量，写入异常，补件到货后再登记。所有获准团队学生均可验收。
6. 未下单 = 申请 − 已下单；待验收 = 已下单 − 累计合格验收。全部商品合格数量等于申请数量，且没有未处理异常，才显示“已到齐”。
7. 更正记录不会删除原验收：更正本人或管理方的记录、填写原因后扣回累计数量；再提交正确记录。异常解决需要文字说明，解决异常本身不会补足缺少的数量。
8. 原表修改不会覆盖已下单/已验收进度。管理方确认变更后按唯一商品名和链接匹配。已下单商品被改名、删除或申请数量降低，平台会要求先核实原表；第一版不提供模糊自动匹配。

同名文件按不同 Drive 文件 ID 分别登记，第一版不自动合并重复提交。修改和验收带订单版本，旧版本请求返回 409，防止多人覆盖及重复点击。

## 配置真实 Drive 读取

使用专用服务账号，仅在本项目后台读取。现有网页上传仍走学生账号的 `drive.file`，文件所有权继续归上传者。

1. 在 Google Cloud 项目 `cart-to-order-form` 的 IAM 与管理 → 服务账号，新建 `order-form-reader`。读取 Drive 文件不需要赋予 Cloud 项目 Owner / Editor，也不需要域级委派。
2. 复制该服务账号的实际邮箱，在 Drive 的固定 `Order Form` 文件夹共享中直接添加为**查看者**，关闭邮件通知。不能把“知道链接可编辑”视为后台已经建立了读取关系。若某些文件有特殊访问限制，应单独核对。
3. 提供后台凭据：优先使用工作负载身份/ADC。支持 `DRIVE_SERVICE_ACCOUNT` 指定服务账号并通过 GoogleAuth 的 Impersonated 凭据取得 `drive.readonly` 令牌；调用身份需要在该服务账号上的 Token Creator 权限。
4. 如首轮本机验收需要 JSON 私钥，在 Console 的该服务账号 → 密钥中创建后，将文件保存到**仓库外**的私有目录，目录 700 / 文件 600；仅在本机 `.env` 中填写绝对路径 `GOOGLE_APPLICATION_CREDENTIALS`。不要把私钥内容发到聊天，不要提交到 Git，也不要放入浏览器配置。退出测试后按使用需求管理或撤销该密钥。
5. 将 `.env.example` 复制为 `.env`，保留固定 `DRIVE_FOLDER_ID`。`npm start` 后查看后台同步状态，纳入真实订单前人工核对数量。

后台程序仅调用 Drive 列举、下载和导出接口，并申请 `drive.readonly`。这个范围不是“仅一个文件夹”的 OAuth 范围；服务账号可见范围由 Drive 共享关系决定，程序还固定检查目标 parent ID。现有“知道链接可编辑”不会因为新增直接查看者而被收紧，平台角色也不会改变 Drive 原有共享权限。

Drive 上的 `.xlsx` 用 `files.get?alt=media` 读取，原生 Google 表格用 `files.export` 导出 XLSX 再读取，均支持标准 HKUST 商品列。商品按实际行读取，超出 100 项、多张订单工作表、商品表后还有数量行或无效数量会明确提示人工处理，不截断后冒充完整导入。解析器版本变更会重新读取已有表，保留进度并提示内容差异。签名图片不存进平台数据库；需要查看原签名时打开 Drive 原表。

## 配置 Google 登录与角色

平台登录和后台读取使用两套身份，学生登录只用于识别操作人，不申请 Drive 全盘读取权限。

1. 在同一 Cloud 项目创建**独立**的 Web OAuth 客户端，例如 `Order Platform Local`，用于本机验收。JavaScript origin 只填 `http://127.0.0.1:8787`，不填路径，无需 secret。不要把本地地址加回旧生产上传客户端。
2. 将新 Client ID 填入 `.env` 的 `GOOGLE_CLIENT_ID`。
3. 第一次 `npm start` 后用实际管理员账号登录，会先显示待批准页面。复制页面上由 Google 验证的账号 ID，在后台目录运行 `node tools/bootstrap-admin.mjs 该账号ID`，然后点击重新检查。工具只接受已完成后台 Google 验证的账号，将其设为首位管理员，并将 ID 写入本机 `.env` 的 `BOOTSTRAP_ADMIN_SUB` 以便以后启动。也可手工配置该字段后重启。不要凭 Student Name 或可编辑的前端字段授予角色。
4. 管理员在“成员与角色”批准其他已登录成员为学生或管理方。无需预先收集团队邮箱清单。未知 Google 账号只进入待批准页面，不能读订单。
5. 所有获准学生均可验收。管理方可下单、确认到校、核实原表；管理员还可管理角色。角色变更会撤销该账号旧会话。

服务端验证 Google ID token 的签名、audience、issuer 和过期时间。会话使用 HttpOnly / SameSite Cookie，正式模式额外 Secure；变更请求检查来源和会话 CSRF token。验收人取自服务端会话，不能在请求里冒充他人。

## 运行和部署

这个目录是独立 Node 后端。原 Vercel / GitHub Pages 的静态上传网页不能直接托管带本地数据库的后台。

- 本机真实验收：`npm start`，保持电脑及进程运行。
- 团队正式使用：部署到有持久化磁盘的 Node 服务器/容器，单实例运行，配 HTTPS 反向代理和受控目录。提供了 Dockerfile；尚未实际构建或部署镜像。
- 设置 `NODE_ENV=production`、`PUBLIC_ORIGIN=https://实际管理平台域名`、`HOST=0.0.0.0`、持久化 `DB_PATH`、Google login Client ID、管理员 sub 和后台 ADC/读取身份。正式模式缺少 HTTPS / 登录 client / 管理员 sub 会拒绝启动。
- SQLite 的 `DB_PATH` 必须在永久磁盘上。不要直接放在会重置临时文件系统的 Vercel Functions / Cloud Run 实例中，也不要用多实例各自一份数据库。若以后需要自动伸缩，再迁移共享数据库。
- 后台常驻进程负责定时同步，浏览器关闭后仍会运行。进程停止会停止同步；恢复后重新扫描。页面显示最近同步时间及失败状态。
- HTTPS 域名确定后给正式管理平台使用独立 OAuth 客户端，保留生产/本地客户端分离。费用及具体托管方另行确认，当前没有创建付费服务。

本机 `.env` 示例：

```text
HOST=127.0.0.1
PORT=8787
PUBLIC_ORIGIN=http://127.0.0.1:8787
GOOGLE_CLIENT_ID=实际的新平台客户端.apps.googleusercontent.com
BOOTSTRAP_ADMIN_SUB=实际管理员Google账号ID
DRIVE_FOLDER_ID=1EC0L0S0kHn8UAIEY-nukXsTujPfX2ImG
GOOGLE_APPLICATION_CREDENTIALS=/仓库外私有目录/order-form-reader.json
```

## 验收与备份

```sh
npm test
npm audit --omit=dev
node tools/backup.mjs data/orders.sqlite /私有备份目录/orders-backup.sqlite
```

备份工具使用 SQLite 的在线备份 API，可在后台运行时使用。备份完成后再将副本送入你管理的备份存储，实际数据与备份都不进 Git。

真实接入验收顺序：

1. 登录、批准一名管理方及两名学生。
2. 后台自动发现原文件夹表格，核对 XLSX / Google 表格的项目和数量；预算表排除，历史已完成表归档。
3. 只用明确 TEST 表完成：部分下单 → 全部下单 → 第一批到校 → 学生甲部分验收 → 第二批到校 → 学生乙补齐 → 已到齐。
4. 在 Drive 新增一个 TEST 表，等待自动轮询出现；再次同步不重复导入。
5. 改 TEST 原表数量，确认变更提示及已验收数量保留；恢复或确认变更。移出 TEST 文件后已有记录保留并提示原表缺失。
6. 重启后台，确认状态及操作人仍在；验证学生调用管理接口被拒绝。

历史数据没有实际状态证据时保留待核实，不自动推定已下单、已到校或已验收。

官方依据：[服务账号直接共享文件](https://developers.google.com/workspace/guides/create-credentials#access-google-workspace-files-directly-with-a-service-account)、[Drive 权限范围](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)、[文件列举](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)、[Google ID token 验证](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)、[服务账号密钥管理](https://docs.cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys)。
