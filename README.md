# Taskleaf-Kanban

个人任务看板：原生 HTML / CSS / JavaScript 前端，Vite 构建，Express API，JSON 文件持久化。不需要数据库、React、Vue 或 PM2。

## 功能

- 待处理、进行中、待验收、已完成四列，支持编辑、删除、拖拽排序、搜索、优先级筛选。
- 归档与恢复、标签、描述、负责人兼容字段、截止日期。
- “已完成”列支持一键全部归档（包括被搜索或优先级筛选隐藏的已完成任务）；无任务时按钮禁用，可在归档页逐项恢复。
- 描述支持全屏查看与编辑；完成编辑、退出全屏或 Esc 返回时保留草稿，点击“保存任务”才提交。
- 同一服务的浏览器共享任务；刷新读取最新数据，不是实时协作。
- 保存失败保留表单输入；旧版本修改返回冲突，不静默覆盖。
- JSON 导入预览、同 ID 去重、冲突拒绝、导出备份。
- 设置 → 复制 JSON：读取服务器全部任务（含归档）并复制格式化备份，不受筛选影响；自动复制被浏览器阻止时提供全选文本供手动复制。
- 服务端串行写入、临时文件替换、最后有效版本 `.bak` 备份。

## 本地运行

使用 Node.js 24 和 npm：

```sh
npm ci
npm run dev
```

同时启动前端与后端：

- 页面：`http://127.0.0.1:4173/task-board.html`
- API：`http://127.0.0.1:3000/api/tasks`（仅回环监听）
- 数据：项目下 `data/tasks.json`，自动初始化为空看板，已被 Git 忽略。

在 Chrome 和 Edge 打开同一个页面地址即可共享数据。后端代码修改后重启 `npm run dev`；也可分别使用 `npm run dev:api`（监听代码变化）与 `npm run dev:web`。

不能只打开 HTML 文件，也不能只启动静态预览而不启动 API。构建预览需要分别启动 `npm start` 与 `npm run preview`，页面端口为 4174。

## 数据管理

任务统一由后端保存在 JSON 文件中，页面打开时读取，保存成功后更新看板。其他浏览器修改后，使用浏览器自带刷新读取最新任务；不提供独立“刷新数据”按钮。

右上角“设置”菜单提供“导出 JSON”和“导入 JSON”。旁边的明暗切换按钮可切换主题：首次跟随系统，手动选择后保存在当前浏览器（仅主题偏好，不保存任务）。导入前显示预览；ID 相同、内容相同的任务跳过，ID 相同而内容不同则拒绝整个导入，不静默覆盖。

不再提供浏览器旧任务迁移入口，也不读取或删除原来的 localStorage 数据。

## 保存与冲突

任务文件包含 `schemaVersion: 1`、递增 `revision` 和 `tasks`。修改请求必须带读取时的 revision。

如果其他窗口已修改数据，本次修改会失败，表单输入保留。复制草稿，关闭窗口，使用浏览器刷新页面，重新打开任务核对后重试。网络中断时结果可能未确认，先刷新核对；不会悄悄改存 localStorage。

仅允许一个后端进程写同一文件，不启动多实例。总任务上限 10000 项、规范化数据上限 4 MB，请求上限 5 MB；超出会明确拒绝。

## 测试与构建

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

浏览器测试使用独立临时数据与端口 5179 / 3019，不接触日常数据。已安装 Chrome 或 Edge 时可以通过 `E2E_CHANNEL=chrome` 或 `E2E_CHANNEL=msedge` 运行；PowerShell 示例：

```powershell
$env:E2E_CHANNEL = 'msedge'
npm run test:e2e
```

`dist/` 是前端产物，不含后端；生产发布也必须包含后端与生产依赖。

## 备份与恢复

```sh
npm run backup
```

默认从 `data/tasks.json` 生成 `backups/` 下的时间戳快照。可用 `DATA_FILE` 与 `BACKUP_DIR` 改路径。`.bak` 只保留上一次有效版本，不替代定期或异地备份。

需要完整恢复时，先停止所有后端写入进程，再执行：

```sh
npm run restore -- --offline-confirmed /absolute/path/backup.json
```

恢复前保留原始文件（即使已损坏），恢复时提升 revision 以使旧窗口失效。之后重新启动服务，并刷新所有浏览器。恢复前请确认路径和备份内容；正常“导入 JSON”是合并，不等于完整回滚恢复。

## 部署与安全边界

服务端 JSON 必须放在发布目录之外。使用 systemd 管理 Node，Nginx 提供前端与 `/api/` 代理。

**目前不含应用层登录。后端只允许回环监听；Nginx 模板默认仅监听回环且拒绝所有访问，必须在确定访问来源与保护传输方式后配置。不要直接将开发服务器或无保护 API 暴露到公网。**

CI 在 push / PR 时测试和构建。只有仓库变量 `DEPLOY_ENABLED=true`、生产环境与 SSH Secrets 配齐后，才自动部署 main；当前已启用并验证服务器自动部署（2026-09-14）；推送 main 会自动发布，任务数据仍保存在服务器独立目录。

详见：

- [产品需求](docs/PRD.md)
- [技术选型](docs/TECH_STACK.md)
- [服务器配置、CI/CD 与恢复操作](docs/DEPLOYMENT.md)
- [任务完成后的提交确认规则](agent.md)

## 粘贴 AI 任务 JSON

设置 → 粘贴 JSON → 预览追加结果 → 确认导入，无需先保存为文件。每项至少提供 id 和 title，只追加新 ID，不覆盖已有任务；同 ID 同内容跳过，不同内容会提示冲突。输入示例与字段约束见 [助手录入任务](docs/TASK_INTAKE.md)。
