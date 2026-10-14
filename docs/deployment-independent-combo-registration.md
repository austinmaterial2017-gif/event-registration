# 组合项目专属资料：安全发布与检查清单

这次更新包含公开报名网页、公开 Apps Script 后端，以及受保护的工作人员／管理员 Apps Script。请保持现有网页网址、Apps Script 部署网址、Script Properties 与权限不变；只建立新的部署版本。

## 发布前确认

已在本机完成：

- `npm test`
- `npm run check:bundles`
- `npm run check:public`
- `git diff --check`

不要把 `staff-apps-script/`、`apps-script/`、`source-bundles/` 发布到 GitHub Pages；Pages 只发布 `public/`。

## 1. 更新公开 Apps Script 后端

打开现有的**公开后端** Apps Script 项目。以 [public-backend.txt](../source-bundles/public-backend.txt) 内每一个 `===== 文件名 =====` 分隔标题为准，逐个全选替换同名文件内容。

保存后选择“部署 → 管理部署 → 编辑”，建立一个**新版本**，保持原本的 Web App URL 不变。

不要删除旧版本，不要改 Script Properties。

## 2. 更新工作人员／管理员 Apps Script

打开现有的**工作人员／管理员** Apps Script 项目。以 [staff-admin.txt](../source-bundles/staff-admin.txt) 内每一个 `===== 文件名 =====` 分隔标题为准，逐个全选替换同名文件内容。

特别确认下列两个文件已经更新：

- `Admin.html`：浅色管理员首页与功能卡片。
- `AdminScript.html`：组合项目专属题目选择与原有按钮处理。

保存后同样建立新版本，维持原本管理员 URL 与访问权限不变。

## 3. 发布 GitHub Pages 前端

只发布本项目的 `public/` 文件夹。必须包含：

- `public/js/bundle-register-page.js`
- `public/css/app.css`
- `public/bundle-register.html`
- 以及本次同一批次内已修改的公开文件。

推送／发布成功后，等待 GitHub Pages 完成部署，再以无痕窗口或强制刷新打开首页。

## 4. 不提交真实报名的上线检查

1. 首页同时显示普通活动和组合活动；加载时先显示“正在加载活动及组合活动，请稍候…”。
2. 打开组合活动，未选择项目时只显示共用资料；勾选羽球时出现“羽球资料”，取消后该区消失。
3. 在后台进入“组合报名 → 编辑计划 → 组合报名资料问题”，确认可以选择“只在选择某项目时显示”。
4. 组合报名预览中，共用资料与项目资料分区显示。
5. 打开找回电子凭证页，确认普通活动与组合活动均可选择。
6. 打开工作人员扫码页，确认普通活动与“组合：计划名称 · 项目名称”均可选。
7. 选择一个测试 QR 后，必须看到明确成功、重复、未到时间或无效的反馈；不要用真实参加者资料做测试。

若任一步骤不符合，立刻在 Apps Script 的“管理部署”切回上一版本；不要删除新加的 Sheet 栏位或旧报名资料。
