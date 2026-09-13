# 部署与运维操作说明

首次服务器安装已完成：Taskleaf 由 systemd 管理并已开启开机自启，Nginx 和 API 仅监听服务器回环地址；已验证页面和健康接口，并由用户确认 SSH 隧道访问正常。目前公网 IP＋端口直接访问及 GitHub Actions 自动部署尚未启用，仍需确认访问保护和配置部署凭据。本文保留通用占位符，不提交真实凭据。

## 1. 上线前的必备条件

- Linux + systemd、Node.js、npm、Nginx、SSH、tar、curl。首次安装脚本接受 Node.js 22.12+（22.x）或 24+；当前服务器使用 22.23.2，CI 使用 24，不需要为本项目升级服务器全局运行时。
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

## 8. 辅助首次安装（手动 sudo）

`deploy/bootstrap.sh` 只用于全新安装。先在本地构建，将不含真实任务、凭据和 node_modules 的发布包及脚本上传至部署用户的独立目录。该目录需包含 `bootstrap.sh`、`release.tgz`、`release.sha256` 和 `release-id`。

管理员在自己的 SSH 终端执行（替换实际上传目录）：

```bash
sudo bash /home/DEPLOY_USER/taskleaf-bootstrap/RELEASE/bootstrap.sh /home/DEPLOY_USER/taskleaf-bootstrap/RELEASE
```

- 脚本核对校验和、运行环境、端口及已有安装；不会升级系统 Node.js。已有 Taskleaf 目录、账号或配置时拒绝覆盖。
- 创建专用服务用户、独立数据目录及 systemd 服务；仅新增 Taskleaf Nginx 配置并在校验通过后 reload。
- 初次监听固定为服务器回环地址：API `127.0.0.1:3000`，Nginx `127.0.0.1:8080`。不开放公网端口、不修改防火墙、不配置 sudoers 或 GitHub Secrets。
- sudo 密码只在自己的终端输入，不要发到聊天或写进脚本。中途失败时保留输出，先检查部分安装状态，不要删除数据或盲目重跑。
- 安装输出成功后，在本地另一终端建立 SSH 隧道，再浏览 `http://127.0.0.1:18080/task-board.html`：

```bash
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:18080:127.0.0.1:8080 DEPLOY_USER@SERVER_IP
```

这是首次验证的临时访问方式，不代表公网访问和 CI/CD 已启用；二者需在访问保护与部署凭据确认后另行配置。

### npm 下载中断后的续装

若首次安装仅在 `npm ci` 阶段出现网络错误，先检查服务用户、正式数据目录、systemd 单元和 Nginx 配置均未创建。不要直接重跑或删除 `/opt/taskleaf`。

可在网络正常的机器中，以相同 package.json 和 package-lock.json 在独立目录执行 `npm ci --omit=dev --ignore-scripts --no-audit --no-fund --cache <独立缓存目录>`，只传输该缓存的 `_cacache`，不传输本机 node_modules 或用户全局缓存。服务器在该发布目录以部署用户执行 `npm ci --offline --omit=dev --ignore-scripts --no-audit --no-fund --cache <上传的缓存目录>`，由锁文件校验完整性并在服务器安装依赖。此操作不修改全局 registry，也不升级包。

离线安装及模块导入验证通过后，管理员可以使用相同发布包续装：

```bash
sudo bash /absolute/bundle-directory/bootstrap.sh /absolute/bundle-directory --resume-after-deps
```

续装仍检查端口和正式安装路径，逐一核对发布包中的源文件哈希，并验证生产依赖；跳过解压和联网安装。该入口仅处理服务配置之前的依赖阶段失败，不用于一般升级或数据恢复。后续 CI 依赖下载通道仍需另行验证，不能由本次离线安装推断自动部署已可用。

### Windows 本地端口与 SSH 隧道

本项目实际遇到 Windows 将 8072–8171 列为 TCP 保留端口，绑定本地 8080 返回 `Permission denied`。因此上述隧道改用本地 18080；服务器 Nginx 仍使用 127.0.0.1:8080，API 仍使用 127.0.0.1:3000。该范围是当时该机器的检查结果，不代表其他机器的端口范围。

在 Windows 本地 PowerShell（不是服务器终端）运行隧道命令，并保持窗口打开；浏览器访问 `http://127.0.0.1:18080/task-board.html`。断开隧道只会中断本地访问，不会停止服务器服务。

排查本地端口时可执行：

```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq 18080
```

后端会校验包含端口的 Host，所以不能只改 SSH 命令而不调整白名单。新版首次安装脚本已包含 `127.0.0.1:18080` 和 `localhost:18080`；旧安装如未包含，管理员应在服务器 `/etc/taskleaf/taskleaf.env` 的 `ALLOWED_HOSTS` 中保留原条目并追加这两项，再执行 `sudo systemctl restart taskleaf`。当前服务器已完成此调整。不要因此开放公网 API 端口或删除 Host 校验。
