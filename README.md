# 活动报名与电子凭证系统

这是一个可发布到 GitHub Pages 的中文活动报名网站，后端使用两个彼此隔离的 Google Apps Script Web App：

- `public/`：参与者活动列表、报名、凭证查询和只读验票；它是唯一可公开发布的目录。
- `apps-script/`：匿名可访问的公开 API，由部署者执行。
- `staff-apps-script/`：要求登录的工作人员签到与管理员页面，由访问者执行；绝不能放进 GitHub Pages。

> 发布前先运行 `npm.cmd run check`。它会运行全部行为测试、核对可复制的 Apps Script 源码包，并检查公开目录是否意外带入私密内容。

## 上线前准备

准备一份长期保留、私有的 Google Sheet，作为**永久注册表（registry Sheet）**。它保存 `ADMIN_SETTINGS`、活动目录、票券索引与系统审计；两个 Apps Script 项目的 `ACTIVE_SPREADSHEET_ID` 脚本属性都固定指向它。永久注册表会继续保留，不要替换、删除或公开分享。

升级后的资料模型如下：

- 每个新活动都会自动建立一份独立、私有的 Google Sheet。公开后端项目负责建立及初始化，建立活动的已授权管理员会取得编辑权限。
- 只需在升级后第一次运行时批准一次新增的 Google Drive 权限。
- 以后新增活动不需要建立、修改或重新部署 Apps Script，也不需要输入 Sheet ID。
- 不会自动拆分已有且非空的旧活动资料；请先备份，再按下方的旧资料说明另行规划迁移。

公开后端的部署者帐户必须可使用永久注册表，并会拥有它自动建立的活动 Sheet。工作人员与管理员的网关操作不需要直接分享永久注册表或活动 Sheet；登录帐号只需在对应 allowlist。只有点击受保护的 `sheetUrl`、直接在 Google Sheets 查看或编辑的人，才需要拥有者另行授予该 Sheet 权限。

## 升级既有受保护部署

保留既有的公开／工作人员 Apps Script 项目、正式部署 URL 与升级前的两个部署版本，不要为这次升级重建项目或更换 URL。先备份永久注册表，并安排暂停参与者提交及工作人员／管理员变更的维护时段。

1. 把 `source-bundles/public-backend.txt` 更新到既有公开项目并保存为候选版本，但先不要切换 `/exec` 部署。先运行一次 `setupSystem()` 预检并批准新增的 Drive 权限；只有预检成功，才把**同一个公开部署**切到新版本。若出现 `LEGACY_MIGRATION_REQUIRED`，立即停止升级：不要初始化、移动或删除旧资料，也不要切换公开或工作人员部署，保持两个旧版本继续生效，待完成经核对的迁移映射后再重试。
2. 把 `source-bundles/staff-admin.txt` 更新到既有工作人员项目，复核脚本属性仍指向既有永久注册表与正式公开后端，再把**同一个工作人员部署**切到新版本。
3. 完成两活动的 Sheet、报名、QR、签到与管理员导航检查后，才恢复流量。

若验证失败，保持维护时段，先把工作人员部署恢复到旧版本，再恢复公开部署；这个顺序避免新工作人员代码调用旧公开后端没有的动作。随后复测旧版报名、凭证、验票与签到路线。代码回滚不会撤销已初始化的注册表、已建立的私有 Sheet 或已写入的数据；这些项目必须人工核对，绝不能在回滚时自动删除。

## 全新安装：严格按此顺序

### 1. 创建并初始化公开项目

1. 新建一个**匿名公开**的 Apps Script 项目。
2. 逐个粘贴 `apps-script/` 内的文件；也可从受保护的管理员页面复制 public source bundle 后，按分隔标记建立文件。
3. 在「项目设置 → 脚本属性」设置：
   - `ACTIVE_SPREADSHEET_ID`：永久注册表的 Sheet ID。
   - `SWITCH_PROBE_SHARED_SECRET`：随机生成、至少 32 个字符的机密；稍后在工作人员项目使用完全相同的值。
   - `INTERNAL_API_SHARED_SECRET`：另一组随机生成、至少 32 个字符的机密；稍后在工作人员项目使用完全相同的值。不要与上一项共用。
   - `PUBLIC_BASE_URL`：参与者网站的 GitHub Pages 根网址，例如 `https://你的帐号.github.io/仓库名`；若网址尚未建立，可在发布 Pages 后补上并重新部署公开 Web App。
4. 在编辑器中手动运行一次 `setupSystem()`，批准新增的 Drive 权限并初始化永久注册表表头。它不会清空或拆分已有资料，也不会建立示例活动。这个 Drive 授权只在升级后的第一次运行请求一次。
5. 部署为 Web App：**以部署者身份执行**、**所有人（含匿名访问者）**。复制 `/exec` 公开 URL。
6. 在 [`public/js/config.js`](public/js/config.js) 填入公开 Apps Script URL 和参与者网站根网址：

   ```js
   export const APPS_SCRIPT_WEB_APP_URL = "https://script.google.com/macros/s/你的公开部署ID/exec";
   export const PUBLIC_BASE_URL = "https://你的帐号.github.io/仓库名";
   ```

不要在公开目录写入 Sheet ID、共享密钥、工作人员/管理员 URL 或名单。

### 2. 创建工作人员与管理员项目

1. 新建另一个**要求登录**的 Apps Script 项目。不要从公开项目再建一个部署；两个项目必须独立。
2. 粘贴 `staff-apps-script/` 内的文件；也可复制受保护管理员页面中的 staff/admin source bundle。
3. 设置脚本属性：
   - `ACTIVE_SPREADSHEET_ID`：与上一步相同的永久注册表 Sheet ID；它是稳定根，不要填任何活动 Sheet。
   - `ATTENDANCE_STAFF_ALLOWLIST`：规范化 Google 帐户邮件地址的 JSON 数组，例如 `["door-team@example.com"]`。
   - `ADMIN_EMAIL_ALLOWLIST`：管理员邮件地址的独立 JSON 数组。
   - `PUBLIC_BACKEND_URL`：上一步公开项目的正式 `/exec` URL。
   - `SWITCH_PROBE_SHARED_SECRET`：与公开项目完全相同的至少 32 字符机密。
   - `INTERNAL_API_SHARED_SECRET`：与公开项目完全相同的另一组至少 32 字符机密，用于签署工作人员签到及管理员操作。
4. 部署为 Web App：**以访问 Web App 的使用者身份执行**、**要求登录**（可用时限制为组织网域）。
5. 分发这个部署 URL 仅限受保护的工作人员/管理员渠道。普通签到页使用该 URL；管理员页为 `?view=admin`。不得把这两个 URL 放进 GitHub、二维码、参与者讯息或 `public/`。

`ATTENDANCE_STAFF_ALLOWLIST` 与 `ADMIN_EMAIL_ALLOWLIST` 互不授予权限：需要两种角色的人必须同时出现在两个名单。网关操作不要求该帐号直接拥有注册表或活动 Sheet 权限。系统以 `Session.getActiveUser().getEmail()` 判断已登录身份，忽略浏览器提交的身份资料；空白 Session 身份与未授权身份都会得到相同的拒绝页面。

### 3. 填写管理员设置并发布 Pages

1. `setupSystem()` 已在永久注册表的「系统设置」页中首次写入一个有效、保守的 `ADMIN_SETTINGS` JSON（空的报名/签到策略，所有可选权限默认关闭）。使用已授权管理员打开工作人员项目的 `?view=admin` 后再按需要更新活动策略。此行是两个项目共同信任的唯一策略来源；若后来被删除、清空或改成错误格式，系统会安全地拒绝服务，不能以脚本属性替代。
2. 在管理员页建立活动。每次建立新活动时，系统会自动建立并初始化一份私有 Sheet；页面只向已授权管理员显示该活动的受保护 Sheet 链接。随后配置场次、座位和报名问题，并确认公开活动流程可用。
3. 在发布 GitHub Pages 前，按实际站点修改 `public/404.html` 的 `github-pages-base-path`：用户/组织根站点填 `/`，项目站点填 `/仓库名/`（本仓库默认 `/event-ticket-system/`）。404 页不依赖相对 CSS 路径，并会使用这个明确配置返回活动首页。
4. GitHub Pages **仅**发布本仓库的 `public/` 目录。不要发布仓库根目录、`apps-script/`、`staff-apps-script/`、`source-bundles/`、测试或管理 HTML。

公开 Pages URL 用于参与者报名；工作人员 Web App URL 用于签到；附带 `?view=admin` 的工作人员 URL 用于管理。三者用途不同，后两者始终私下分发。

## 活动状态与日常操作

管理员依次建立活动、场次、座位和报名问题。参与者页面只显示适合公开的状态：

- `draft`：草稿，不公开。
- `upcoming`：可显示倒数，但尚未开放报名。
- `open`：可报名；公开表单会按场次选择、座位模式和必填问题进行校验。
- `closed`：停止新报名。
- `live`：活动进行中，停止新报名；已授权工作人员可按场次签到。
- `ended`：活动结束，凭证会显示结束状态。
- `cancelled`：活动/凭证已取消，不能继续使用。
- `archived`：归档，不在公开活动列表显示。

一张活动可设多个场次，必选场次、最少/最多选择数和名额均在后端再次校验。座位模式可为自由入座、系统分配、自选座位或分区选择；只有自选/分区模式会要求参与者选择座位。参与者依次选择开放活动、场次、座位、填写必填资料、核对并提交，成功后取得凭证。不同场次的 QR/验票都绑定各自场次：同一张凭证可在场次 A 与 B 分别独立签到。

## 旧系统资料与高级维护

Legacy preflight is strict: every nonempty legacy business row with an
`eventId` needs a nonblank value, and every distinct ID must resolve exactly
once through the normal catalog route to a non-registry activity Sheet with
exact schema and matching activity row. `参加者` rows and legacy `报名项目` rows
must have exactly matching, unique `participantId` relationships; each
participant and registration resolves to one event, while repeated rows of the
same triple remain valid for multiple sessions. Any other legacy business tab
without an `eventId` relationship is rejected. This check also runs before a
candidate registry can be activated, so advanced switching cannot bypass
migration review.

这次升级只会为**升级后新建**的活动自动建立独立 Sheet，不会扫描或重排旧表。`setupSystem()` 会在初始化前检查永久注册表：若发现非空的「活动」「场次」「座位」「报名问题」「参加者」「报名项目」或「签到记录」旧业务资料、但没有完成的活动目录映射，就会以 `LEGACY_MIGRATION_REQUIRED` 失败。失败不会新增或修改目录／索引，也不会移动或删除旧资料；必须保持旧部署版本生效，先完整备份并完成逐项迁移与核对，再重新运行预检。完成前不要删除旧表或手工伪造活动目录／票券索引。

管理员页「高级维护」中的整表切换属于旧系统维护工具，不是新增活动的正常流程。切换只可由已授权管理员发起。先用「测试连接」确认候选 Sheet 已有精确的初始化表头和权限，再明确确认切换。系统会：

1. 在永久注册表写入短时维护记录与一次性 nonce；新报名、取消、换座、签到和管理员修改会安全失败。
2. 让公开 Apps Script 的部署者从注册表读取候选 Sheet，并以共享密钥签名确认它可访问且表头正确。
3. 管理员项目只在收到未过期、nonce 匹配的确认后才更新 `ACTIVE_SPREADSHEET_ID` 指针。

不要把整表切换当成每活动建表方式，也不要在维护中手工修改指针。维护记录过期后会自动失效并尝试清理；即使清理失败，过期本身不会延长维护。若浏览器中断，等待到期后重新进行「测试连接 → 确认切换」。旧业务 Sheet 的资料会被完整保留；系统不会自动复制、迁移、初始化或删除旧的业务行。

## 源码包更新

修改任何被复制进 Apps Script 的文件后，执行：

```powershell
node scripts/build-internal-mutation-service.mjs
node scripts/build-admin-source-bundles.mjs
node scripts/build-admin-source-bundles.mjs --check
```

第一条命令先从受保护管理员源码重新生成公开后端的内部变更服务；第二条会重新生成 `source-bundles/*.txt` 和 `staff-apps-script/SourceBundles.gs`；第三条只验证是否同步。完成这次升级后，把两个更新后的源码包分别复制到既有的两个 Apps Script 项目，保存并建立新部署版本。以后建立活动不需要再次改 Apps Script。前端改动才需要重新发布 `public/` 到 GitHub Pages。

若 `public/js/config.js` 已由占位符改成真实公开 `/exec` URL，操作人员必须从两个**独立命名的部署**分别取得公开与工作人员 URL，并在命令外做人工确认后提供两者：

```powershell
$env:PUBLIC_APPS_SCRIPT_WEB_APP_URL = "https://script.google.com/macros/s/你的公开部署ID/exec"
$env:STAFF_APPS_SCRIPT_WEB_APP_URL = "https://script.google.com/macros/s/你的工作人员部署ID/exec"
npm.cmd run check
Remove-Item Env:PUBLIC_APPS_SCRIPT_WEB_APP_URL
Remove-Item Env:STAFF_APPS_SCRIPT_WEB_APP_URL
```

占位符配置不需要这些环境变量。检查会确认配置值等于人工提供的公开 URL、公开与工作人员 URL 不相同，并确认公开包不含工作人员 URL 或第二个 Apps Script URL。它**不能**从 URL 本身加密或可靠地证明哪个部署是公开/工作人员项目；部署来源、执行身份与访问策略仍须由操作人员在 Google Apps Script 中人工核对。

## 常见问题

| 现象 | 检查与处理 |
| --- | --- |
| 工作人员能登录却无法签到/管理 | 帐户必须符合对应 allowlist，两个项目必须使用相同的内部共享密钥，工作人员项目的 `PUBLIC_BACKEND_URL` 必须指向已升级的公开部署；签到与管理员名单是两份独立 JSON。 |
| `Session` 身份为空 | 该工作人员部署必须是「以访问者身份执行」且要求登录；使用目标 Google 帐户重新登录。不要尝试让浏览器传入邮件地址。 |
| Pages 显示网络或 CORS 错误 | 确认 `public/js/config.js` 是公开项目的 `/exec` URL（不是 `/dev`、不是工作人员 URL），然后在 Apps Script 保存并重新部署新版本。 |
| 新活动没有建立 Sheet | 确认公开后端已升级到最新源码包、已批准 Drive 权限，并且永久注册表仍由 `ACTIVE_SPREADSHEET_ID` 指向。不要手工输入活动 Sheet ID。 |
| 其他管理员无法直接打开活动 Sheet | 建立活动的管理员会自动取得编辑权限；由 Sheet 拥有者另行分享给其他需要直接访问的人。日常管理员操作本身仍走受保护后端。 |
| 旧活动没有出现在新活动目录 | 这是预期的安全行为：非空旧资料不会自动拆分或迁移。先备份，再执行经核对的人工迁移方案。 |
| `ADMIN_SETTINGS` 无效 | 在永久注册表的「系统设置」中填入有效、非空 JSON 对象。空白、缺失或格式错误会故意拒绝服务。 |
| 切换后一直维护中 | 等到维护记录过期，再刷新并从测试连接重新做；不要删旧 Sheet 或手工改共享指针。 |
| 担心旧资料遗失 | 切换不会删除或迁移旧 Sheet 数据。先保留/备份旧 Sheet，再另行制定迁移或导出计划。 |

## 本地交付检查清单

本仓库已包含：

- 参与者公开 Pages、404 页面、公开 API 合约与行为测试。
- 两个隔离的 Apps Script 源码、可复制源码包及同步检查。
- 永久注册表、自动私有活动 Sheet、跨活动票券路由，以及工作人员签到和管理员授权。
- `npm.cmd run check` 的完整测试、源码包、公开包与 JavaScript 语法检查。

上线前仍须由项目拥有者完成：

- 创建一份私有永久注册表，设置脚本属性与允许名单。
- 用这次升级源码更新两个既有 Apps Script 项目；在公开项目批准一次 Drive 权限、初始化注册表并部署新版本，再部署工作人员项目的新版本。
- 从分别命名的公开与工作人员部署取得 URL，人工确认其执行身份与访问策略；仅把公开 URL 写入 `public/js/config.js`，在浏览器用真实帐号验证公开报名与员工签到。
- 只发布 `public/` 到 GitHub Pages，并通过受保护渠道分发工作人员/管理员 URL。
