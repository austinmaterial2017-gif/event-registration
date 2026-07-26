# 活动报名与电子凭证系统

这是一个可发布到 GitHub Pages 的中文活动报名网站，后端使用两个彼此隔离的 Google Apps Script Web App：

- `public/`：参与者活动列表、报名、凭证查询和只读验票；它是唯一可公开发布的目录。
- `apps-script/`：匿名可访问的公开 API，由部署者执行。
- `staff-apps-script/`：要求登录的工作人员签到与管理员页面，由访问者执行；绝不能放进 GitHub Pages。

> 发布前先运行 `npm.cmd run check`。它会运行全部行为测试、核对可复制的 Apps Script 源码包，并检查公开目录是否意外带入私密内容。

## 上线前准备

准备两个长期保留、私有的 Google Sheet：

1. **永久注册表（registry Sheet）**：保存 `ACTIVE_SPREADSHEET_ID` 指针、`ADMIN_SETTINGS` 及切换维护状态；不要把它换掉或删除。
2. **当前业务数据 Sheet**：保存活动、场次、座位、报名和签到数据。首次可与注册表为同一个 Sheet；以后切换时，注册表仍是旧的、永久的根 Sheet。

两个 Sheet 都不要公开分享。公开 Apps Script 的部署者帐户，以及每一位需要操作的工作人员/管理员帐户，均须对注册表和各候选业务数据 Sheet 具有所需访问权限。

## 第一次部署：严格按此顺序

### 1. 创建并初始化公开项目

1. 新建一个**匿名公开**的 Apps Script 项目。
2. 逐个粘贴 `apps-script/` 内的文件；也可从受保护的管理员页面复制 public source bundle 后，按分隔标记建立文件。
3. 在「项目设置 → 脚本属性」设置：
   - `ACTIVE_SPREADSHEET_ID`：永久注册表的 Sheet ID。
   - `SWITCH_PROBE_SHARED_SECRET`：随机生成、至少 32 个字符的机密；稍后在工作人员项目使用完全相同的值。
4. 在编辑器中手动运行一次 `setupSystem()`，完成授权并初始化表头。它不会清空已有资料；空的活动表会加入一条草稿示例活动。
5. 部署为 Web App：**以部署者身份执行**、**所有人（含匿名访问者）**。复制 `/exec` 公开 URL。
6. 只将这个公开 URL 放入 [`public/js/config.js`](public/js/config.js)：

   ```js
   export const APPS_SCRIPT_WEB_APP_URL = "https://script.google.com/macros/s/你的公开部署ID/exec";
   ```

不要在公开目录写入 Sheet ID、共享密钥、工作人员/管理员 URL 或名单。

### 2. 创建工作人员与管理员项目

1. 新建另一个**要求登录**的 Apps Script 项目。不要从公开项目再建一个部署；两个项目必须独立。
2. 粘贴 `staff-apps-script/` 内的文件；也可复制受保护管理员页面中的 staff/admin source bundle。
3. 设置脚本属性：
   - `ACTIVE_SPREADSHEET_ID`：与上一步相同的永久注册表 Sheet ID；它是稳定根，不要填短期的业务 Sheet。
   - `ATTENDANCE_STAFF_ALLOWLIST`：规范化 Google 帐户邮件地址的 JSON 数组，例如 `["door-team@example.com"]`。
   - `ADMIN_EMAIL_ALLOWLIST`：管理员邮件地址的独立 JSON 数组。
   - `PUBLIC_BACKEND_URL`：上一步公开项目的正式 `/exec` URL。
   - `SWITCH_PROBE_SHARED_SECRET`：与公开项目完全相同的至少 32 字符机密。
4. 部署为 Web App：**以访问 Web App 的使用者身份执行**、**要求登录**（可用时限制为组织网域）。
5. 分发这个部署 URL 仅限受保护的工作人员/管理员渠道。普通签到页使用该 URL；管理员页为 `?view=admin`。不得把这两个 URL 放进 GitHub、二维码、参与者讯息或 `public/`。

`ATTENDANCE_STAFF_ALLOWLIST` 与 `ADMIN_EMAIL_ALLOWLIST` 互不授予权限：需要两种角色的人必须同时出现在两个名单，并且拥有 Sheet 权限。系统以 `Session.getActiveUser().getEmail()` 判断已登录身份，忽略浏览器提交的身份资料；空白 Session 身份与未授权身份都会得到相同的拒绝页面。

### 3. 填写管理员设置并发布 Pages

1. `setupSystem()` 已在永久注册表的「系统设置」页中首次写入一个有效、保守的 `ADMIN_SETTINGS` JSON（空的报名/签到策略，所有可选权限默认关闭）。使用已授权管理员打开工作人员项目的 `?view=admin` 后再按需要更新活动策略。此行是两个项目共同信任的唯一策略来源；若后来被删除、清空或改成错误格式，系统会安全地拒绝服务，不能以脚本属性替代。
2. 配置活动、场次、座位和报名问题后，确认公开活动流程可用。
3. GitHub Pages **仅**发布本仓库的 `public/` 目录。不要发布仓库根目录、`apps-script/`、`staff-apps-script/`、`source-bundles/`、测试或管理 HTML。

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

## 安全切换业务数据 Sheet

切换只可由已授权管理员在私有管理员页面发起。先用「测试连接」确认候选 Sheet 已有精确的初始化表头和权限，再明确确认切换。系统会：

1. 在永久注册表写入短时维护记录与一次性 nonce；新报名、取消、换座、签到和管理员修改会安全失败。
2. 让公开 Apps Script 的部署者从注册表读取候选 Sheet，并以共享密钥签名确认它可访问且表头正确。
3. 管理员项目只在收到未过期、nonce 匹配的确认后才更新 `ACTIVE_SPREADSHEET_ID` 指针。

不要手工绕过这段流程，也不要在维护中修改切换指针。维护记录过期后会自动失效并尝试清理；即使清理失败，过期本身不会延长维护。若浏览器中断，等待到期后重新进行「测试连接 → 确认切换」。旧业务 Sheet 的资料会被完整保留；系统不会自动复制、迁移、初始化或删除旧的业务行。迁移要先备份，并由管理员另行规划。

## 源码包更新

修改任何被复制进 Apps Script 的文件后，执行：

```powershell
node scripts/build-admin-source-bundles.mjs
node scripts/build-admin-source-bundles.mjs --check
```

前者会重新生成 `source-bundles/*.txt` 和 `staff-apps-script/SourceBundles.gs`；后者只验证是否同步。然后把更新后的相应源码包重新复制到两个独立 Apps Script 项目，保存并建立新部署版本。前端改动也需重新发布 `public/` 到 GitHub Pages。

若 `public/js/config.js` 已由占位符改成真实公开 `/exec` URL，运行完整检查时还必须在命令外显式提供同一个 URL，防止误把工作人员 URL 放入公开包：

```powershell
$env:PUBLIC_APPS_SCRIPT_WEB_APP_URL = "https://script.google.com/macros/s/你的公开部署ID/exec"
npm.cmd run check
Remove-Item Env:PUBLIC_APPS_SCRIPT_WEB_APP_URL
```

占位符配置不需要这个环境变量。无论哪种模式，公开包都只能有这一个公开 `/exec` URL。

## 常见问题

| 现象 | 检查与处理 |
| --- | --- |
| 工作人员能登录却无法签到/管理 | 帐户必须同时符合对应 allowlist 和 Sheet 分享权限；签到与管理员名单是两份独立 JSON。 |
| `Session` 身份为空 | 该工作人员部署必须是「以访问者身份执行」且要求登录；使用目标 Google 帐户重新登录。不要尝试让浏览器传入邮件地址。 |
| Pages 显示网络或 CORS 错误 | 确认 `public/js/config.js` 是公开项目的 `/exec` URL（不是 `/dev`、不是工作人员 URL），然后在 Apps Script 保存并重新部署新版本。 |
| 表头/切换目标无效 | 候选 Sheet 必须已具备精确表头，且同时分享给公开部署者和所需工作人员；先在管理员页运行测试连接。 |
| `ADMIN_SETTINGS` 无效 | 在永久注册表的「系统设置」中填入有效、非空 JSON 对象。空白、缺失或格式错误会故意拒绝服务。 |
| 切换后一直维护中 | 等到维护记录过期，再刷新并从测试连接重新做；不要删旧 Sheet 或手工改共享指针。 |
| 担心旧资料遗失 | 切换不会删除或迁移旧 Sheet 数据。先保留/备份旧 Sheet，再另行制定迁移或导出计划。 |

## 本地交付检查清单

本仓库已包含：

- 参与者公开 Pages、404 页面、公开 API 合约与行为测试。
- 两个隔离的 Apps Script 源码、可复制源码包及同步检查。
- 工作人员签到、管理员授权、活动/座位/问题/记录管理及安全 Sheet 切换流程。
- `npm.cmd run check` 的完整测试、源码包、公开包与 JavaScript 语法检查。

上线前仍须由项目拥有者完成：

- 创建私有 Google Sheets，设置脚本属性、允许名单与 Sheet 分享。
- 在 Apps Script 中授权、初始化、部署两个独立 Web App，并填写管理员设置。
- 仅把公开 URL 写入 `public/js/config.js`，在浏览器用真实帐号验证公开报名与员工签到。
- 只发布 `public/` 到 GitHub Pages，并通过受保护渠道分发工作人员/管理员 URL。
