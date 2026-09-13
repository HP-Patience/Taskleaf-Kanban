# 部署与运维操作说明

这是待配置的部署模板，不代表已经连接服务器。用户已选择公网 IP＋端口，不要求域名；实际 IP、端口、服务器系统及访问保护仍需确认。

## 1. 上线前的必备条件

- Linux + systemd、Node.js 24、npm、Nginx、SSH、tar、curl。
- 网站端口、后端端口和 SSH 端口分开考虑。模板示例为网站 8080、后端 3000；脚本健康检查固定使用 3000，改后端端口时需同步修改。
- 后端只监听回环；云安全组和系统防火墙不放行后端端口。
- 确认谁可访问网页与 API，以及如何保护传输。当前不含账号系统；IP 白名单不加密 HTTP，不能据此认为公网传输安全。
- Nginx 模板默认为回环监听、deny all。公网启用前应根据确认的 TLS／隧道等方案改配置，同时设置访问限制；不要直接删掉保护规则。
- 确认部署来源可连接 SSH。只允许个人 IP 的规则不会自动允许 GitHub runner；先规划受控部署通道或来源规则，不盲目把 SSH 向全网开放。

## 2. 目录与用户（由管理员首次配置）

```text
/opt/taskleaf/releases/         部署用户拥有，每次发布一个新子目录
/opt/taskleaf/current           当前发布版本符号链接
/var/lib/taskleaf/              taskleaf 服务用户可写，目录权限 0700
/var/backups/taskleaf/          taskleaf 服务用户可写，目录权限 0700
/etc/taskleaf/taskleaf.env      root 拥有，权限 0600，systemd 读取
```

- 创建专用、不可交互登录的 taskleaf 服务用户；部署用户与服务用户分离。
- 发布目录文件需允许 taskleaf 和 Nginx 读取，但真实数据与配置不得放入 dist。
- 管理员安装 `deploy/taskleaf.service`，核对 `/usr/bin/node` 实际路径。
- 根据 `deploy/taskleaf.env.example` 创建环境配置；ALLOWED_HOSTS 填实际公网 IP＋网站端口，并保留 `127.0.0.1:3000` 健康检查地址。
- 配置 Nginx 时保留 `$http_host` 中的端口，前端始终使用同源 `/api`。
- 部署用户仅允许免密执行指定服务重启，例如经管理员使用 visudo 审核：`DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart taskleaf`。不要授予任意 sudo。
- 首次发布完成后管理员执行 daemon-reload 并按需要 enable 服务；缺少 current 时不要提前启动。
- Nginx 配置独立由管理员审核并用 `nginx -t` 验证，不由 CI 自动修改安全规则。

## 3. GitHub 配置

仓库 Secrets：

| 名称 | 内容 |
| --- | --- |
| SERVER_HOST | 服务器 IPv4 地址或主机名（当前脚本不处理 IPv6 地址） |
| SERVER_USER | 专用 SSH 部署用户 |
| SERVER_PORT | 实际 SSH 端口 |
| SERVER_SSH_KEY | 专用部署私钥，不上传仓库 |
| SERVER_KNOWN_HOSTS | 已通过可信通道核验的 SSH 主机公钥行，非默认端口使用对应 `[host]:port` 条目 |

创建 `production` Environment，可设置审批人。仓库变量 `DEPLOY_ENABLED` 默认留空；确认服务器和安全配置就绪后才设为 `true`。

一旦启用，推送 main 会在测试通过后部署；任务完成后的提交确认必须明确提醒这一联动。

## 4. 发布过程

- CI 安装依赖，跑 API 与独立浏览器测试，构建 dist。
- 发布作业再次构建，打包 dist、server、共享 schema、备份恢复脚本、依赖清单和发布脚本。
- 使用带主机校验的 SSH 传输归档到 `/opt/taskleaf/releases/<commit>-<run>-<attempt>`。
- 新目录运行 `npm ci --omit=dev`，安装失败不切换 current。
- 切换 current，重启 systemd，对回环 API 执行健康检查。
- 失败时恢复上一个代码版本并重启；首次发布无旧版本时报告需要人工处理。
- 不修改数据格式、不恢复旧任务文件、不删除历史发布目录；历史版本清理以后确认保留策略再配置。

健康检查证明后端可读数据，但不替代公网端到端验收。首次配置后需从实际浏览器验证 Nginx、访问保护和保存功能。

## 5. 备份

- 每次修改前保存 `tasks.json.bak`，仅一个版本。
- `scripts/backup.js` 生成时间戳快照；模板 `taskleaf-backup.service` / `.timer` 提供每天运行的示例，默认不安装、不启用。
- 确认计划与保留周期后再启用；脚本不自动删除备份，应监控磁盘空间。
- 同一磁盘的备份不抵御磁盘损坏；异地复制方案另行确认。

## 6. 恢复

恢复是覆盖当前数据的运维操作，先核对备份并获得确认：

1. 停止 taskleaf 服务，确保没有其他写入进程。
2. 以 taskleaf 用户、正确 DATA_FILE 环境运行 `node scripts/restore.js --offline-confirmed /absolute/backup.json`。
3. 脚本验证备份，先保存原始字节到 `.before-restore-<时间戳>`，再原子替换；revision 提升，旧窗口不能继续写入。
4. 重启服务，检查日志、健康接口以及实际任务内容；所有浏览器刷新。

数据损坏时服务会拒绝启动或返回错误，不会清空为默认任务。不要通过删掉 tasks.json “修复”，那会丢失恢复线索。

## 7. 首次验收

- 未授权来源无法访问页面或 API。
- Chrome 创建任务，Edge 刷新可见；API 端口不能从公网直连。
- 服务重启与第二次发布后，任务和归档还在。
- 一次独立备份、恢复演练能恢复字段和顺序。
- 检查 systemd 日志与 GitHub Actions 日志，确认没有泄露凭据或任务内容。
