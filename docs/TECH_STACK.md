# Taskleaf-Kanban 技术栈与部署选型

状态：目标设计，尚未实现。需求范围与验收以 [PRD.md](PRD.md) 为准。

## 1. 选型结论

| 层次 | 选择 | 目的与取舍 |
| --- | --- | --- |
| 前端 | HTML、CSS、原生 JavaScript | 复用现有界面，不额外引入 UI 框架或组件库 |
| 开发与构建 | Vite | 本地开发与生成 dist；不是生产后端或 UI 框架 |
| 运行环境 | Node.js，沿用项目建议的 24 主版本 | 本地、CI、服务器保持兼容版本 |
| 后端 | Express | 提供任务 API、参数校验和统一错误响应 |
| 存储 | 服务器 JSON 文件 | 单人低频使用；需要实现写入串行化、冲突检测与备份 |
| 进程管理 | systemd | 开机启动、异常重启、运行用户及日志管理；不安装 PM2 |
| 入口 | Nginx | 提供静态文件，同源反向代理 API |
| CI/CD | GitHub Actions＋SSH 文件传输 | 推送代码后构建、上传、重启并检查服务 |
| 访问 | 公网 IP＋自定义端口 | 不依赖域名；实际端口与访问保护待配置 |

当前仓库仍是 Vite 静态前端，使用 localStorage。Express、API、JSON 服务端持久化和自动部署均属于待实施项。

## 2. 请求链路

```text
浏览器访问 公网IP:网站端口
            │
          Nginx
          ├── /       → dist 静态文件
          └── /api/   → 127.0.0.1:后端端口
                                │
                           Node.js + Express
                                │
                     独立数据目录 / tasks.json
```

网站端口示例为 8080，后端端口示例为 3000，仅为规划示例，部署前检查占用并确认。
前端使用相对路径 /api，避免硬编码公网 IP。Nginx 保留 /api 路径转发到后端；生产前端与 API 同源，不默认开放跨域访问。

本地继续使用 127.0.0.1:4173，后续在 Vite 配置中添加 /api 开发代理。Vite preview 只作构建预览，不替代生产 API 服务。

## 3. 建议代码结构

保留现有页面入口，只按维护需要拆分脚本，不为目录形式重写界面。

```text
Taskleaf-Kanban/
├─ index.html
├─ task-board.html
├─ src/                     # 按需抽取页面逻辑与 API 客户端
├─ server/
│  ├─ server.js              # 服务启动、路由与错误处理
│  └─ store.js               # JSON 校验、版本控制与串行写入
├─ data/
│  └─ tasks.example.json     # 只有结构示例，不含真实任务
├─ tests/                   # API、持久化与关键交互测试
├─ deploy/                  # Nginx、systemd 示例配置
├─ .github/workflows/deploy.yml
├─ docs/PRD.md
├─ docs/TECH_STACK.md
├─ agent.md                 # 文档索引
├─ package.json
├─ package-lock.json
└─ vite.config.js
```

真实数据、备份、环境凭据、node_modules 和 dist 不作为源代码提交。
本文出现的新增文件与目录是规划，不表示已创建。

## 4. API 与存储设计

建议接口：

| 接口 | 用途 |
| --- | --- |
| GET /api/tasks | 返回任务与整体 revision |
| POST /api/tasks | 新建任务 |
| PATCH /api/tasks/:id | 更新字段、状态或归档属性 |
| DELETE /api/tasks/:id | 删除任务 |
| POST /api/tasks/reorder | 原子更新列内顺序及跨列位置 |
| POST /api/tasks/import | 校验并合并导入数据 |
| GET /api/health | 不包含任务或敏感信息的健康检查 |

接口契约在实现前细化；任务字段须兼容现有结构，不提前假定标签、日期或归档字段的实际类型。
存储外层建议包含 schemaVersion、revision 和 tasks，以支持格式迁移和冲突检测。

写入约束：

- 单个后端进程独占文件写入；systemd 不启动多实例，不使用 Node cluster。
- 所有修改走同一写入队列，在队列内部读取当前版本、检查 revision、修改并持久化。
- 客户端提交其读取时的 revision；版本过期返回 409，由页面提示刷新与重试。
- 写入同目录临时文件，完成必要刷新后替换正式文件；只有落盘成功才响应成功并更新内存状态。
- 不宣称临时文件替换可以防止所有断电或磁盘故障，仍需备份与恢复验证。
- 校验请求体大小、字段类型、状态枚举和 ID；数据路径由服务端配置，不能由客户端指定。
- 文件缺失时允许明确的首次初始化；损坏、权限错误等情况不得当成空数据覆盖。
- localStorage 不再作为保存失败时的静默后备，只用于显式迁移或标明未提交状态的草稿。

## 5. 服务器目录与权限

建议布局（路径可配置）：

```text
/opt/taskleaf/releases/<commit>/   # 每次发布的代码、dist 与后端依赖
/opt/taskleaf/current              # 指向当前发布版本
/var/lib/taskleaf/tasks.json       # 运行数据，不在代码发布目录中
/var/backups/taskleaf/             # 备份；另行配置保留策略
/etc/taskleaf/taskleaf.env         # 服务环境配置，不进 Git
```

后端配置项包括 HOST=127.0.0.1、PORT、DATA_FILE 和 NODE_ENV。
使用专用非 root 服务用户；只授予所需数据目录写权限。Nginx 只提供 dist，绝不静态暴露数据、备份或环境文件。
systemd 管理重启与日志；部署用户仅获得发布所需权限，不授予无限制 sudo。

## 6. 公网端口与访问保护

- 云安全组与系统防火墙仅放行实际网站端口，而非机械地开放 80、443 和 3000。
- Node 后端只监听回环地址，后端端口不开放公网。
- SSH 使用实际配置端口，不默认一定是 22；需要让部署来源可达。
- 只允许个人管理 IP 的 SSH 规则不能自动满足 GitHub-hosted runner 的部署访问要求，须单独设计部署来源限制或受控连接方式。
- SSH 使用专用密钥，校验服务端主机指纹，不使用关闭主机校验的简化方案。
- IP＋端口只是寻址方式，不是身份认证；修改端口不能保护私人任务。
- 访问保护和传输加密尚未选定。明文 HTTP 不保护任务与凭据，不能直接在其上发送长期口令作为正式方案。
- 公网发布前确认来源限制或轻量认证，以及不依赖域名的受保护传输方式；静态页面与 API 需一致受保护。

## 7. CI/CD 设计

推荐由 CI 构建，不必在本地构建后把 dist 提交到 GitHub。本地构建保留作验证。

```text
本地修改并验证 → push main → GitHub Actions
  → npm ci → 测试 → npm run build
  → SSH 上传 dist、server、package.json、package-lock.json
  → 服务器新版本目录安装生产依赖（npm ci --omit=dev）
  → 切换 current → 重启 systemd → 健康检查
```

- Express 放入生产 dependencies，Vite 保留在 devDependencies。
- 不从 CI 直接复制 node_modules 到服务器，避免系统或架构不一致。
- 工作流串行发布，防止两次部署交叉切换版本；Action 版本在实施时核验并固定。
- SSH 私钥等凭据使用 GitHub Secrets；主机、端口和路径通过 Secrets 或 Variables 配置。
- 仅同步发布目录，禁止将 rsync --delete 指向数据或备份目录。
- 构建或安装失败时不切换现有版本；切换后健康检查失败时回滚代码并检查状态。
- 回滚代码不回滚任务文件；涉及数据格式变化时先备份，并确保版本兼容或提供独立恢复方案。
- 任务修改只写服务器文件，不推送 GitHub，不触发部署。

## 8. 验证与实施顺序

1. 确认访问保护、服务器参数、备份策略及旧任务迁移范围。
2. 实现 JSON 存储与 API，测试并发、冲突、损坏文件和失败写入。
3. 前端接入 API，保留未提交输入，验证双浏览器共享及持久化。
4. 实现显式导入导出，迁移前备份并验证重复导入。
5. 编写 systemd、Nginx 与 CI/CD 配置，在服务器验证部署、重启和回滚不影响数据。

暂不引入数据库、PM2、前端框架、实时协作或自动离线同步。只有出现实际容量、查询或多人并发需求时再重新评估存储方案。
