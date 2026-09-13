# 部署与运维操作说明

首次服务器安装和公网开放已完成：Taskleaf 由 systemd 管理并已开启开机自启；Nginx 分别监听回环和主网卡 IPv4 的 8080 端口，API 仅监听 127.0.0.1:3000。已从外网直连验证页面、健康接口、任务读取及页面静态资源正常，不依赖 SSH 隧道。匿名读写已按用户要求配置，但本次外网检查未修改真实任务。GitHub Actions 自动部署仍未启用。本文保留通用占位符，不提交真实凭据。

## 1. 上线前的必备条件

- Linux + systemd、Node.js、npm、Nginx、SSH、tar、curl。首次安装脚本接受 Node.js 22.12+（22.x）或 24+；当前服务器使用 22.23.2，CI 使用 24，不需要为本项目升级服务器全局运行时。
- 网站端口、后端端口和 SSH 端口分开考虑。模板示例为网站 8080、后端 3000；脚本健康检查固定使用 3000，改后端端口时需同步修改。
- 后端只监听回环；云安全组和系统防火墙不放行后端端口。
- 已确认任何人均可查看和修改任务；本期不含身份验证和权限控制。HTTP 未加密，不应录入敏感信息。
- 默认安装仍为回环监听；用户明确授权后才使用独立公网模板和 enable-public.sh 切换，不改动其他站点。
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

`production` Environment Secrets（不将明文凭据写入仓库）：

| 名称 | 内容 |
| --- | --- |
| SERVER_HOST | 服务器 IPv4 地址或主机名（当前脚本不处理 IPv6 地址） |
| SERVER_USER | 专用 SSH 部署用户 |
| SERVER_PORT | 实际 SSH 端口 |
| SERVER_SSH_KEY | 专用部署私钥，不上传仓库 |
| SERVER_KNOWN_HOSTS | 已通过可信通道核验的 SSH 主机公钥行，非默认端口使用对应 `[host]:port` 条目 |

已创建 `production` Environment，部署分支策略仅允许 `main`，以上五项 Secrets 已配置；未配置人工审批人。仓库变量 `DEPLOY_ENABLED=false`，待专用账号、SSH 登录及 runner 连通性验证后，经用户确认才设为 `true`。

一旦启用，推送 main 会在测试通过后部署；任务完成后的提交确认必须明确提醒这一联动。

## 4. 发布过程

- CI 安装依赖，跑 API、Linux 发布控制流与独立浏览器测试，构建 dist。
- 发布作业再次构建，执行 `deploy/package-release.sh`，打包 dist、server、共享 schema、备份恢复脚本、依赖清单、发布脚本和专用 npm 缓存。缓存由锁文件在全新目录生成，只打包 `_cacache`，不打包用户全局缓存、私钥、真实任务或本机 node_modules。
- 使用带主机校验的 SSH 传输归档到 `/opt/taskleaf/releases/<commit>-<run>-<attempt>`。
- 服务器先校验归档 SHA-256，再解压并执行 `npm ci --offline --cache <release>/bundle-cache --omit=dev --ignore-scripts --no-audit --no-fund`；无需连接 npm registry。生产依赖安装与模块导入均成功后才切换 current。
- 切换 current，重启 systemd，对回环 API 执行健康检查。
- 切换后服务重启或健康检查失败时恢复上一个代码版本并重启，再验证回滚健康状态；无有效 current 时拒绝执行，首次安装使用 bootstrap 而不是发布脚本。
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

- 公网模式：匿名来源可以访问页面与 API 并修改任务；后端 3000 仍不能从公网直连。
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

这是首次验证的临时访问方式，不代表公网访问和 CI/CD 已启用；公网按已确认的匿名访问策略另行启用，CI/CD 在部署凭据配置后启用。

### npm 下载中断后的续装

若首次安装仅在 `npm ci` 阶段出现网络错误，先检查服务用户、正式数据目录、systemd 单元和 Nginx 配置均未创建。不要直接重跑或删除 `/opt/taskleaf`。

可在网络正常的机器中，以相同 package.json 和 package-lock.json 在独立目录执行 `npm ci --omit=dev --ignore-scripts --no-audit --no-fund --cache <独立缓存目录>`，只传输该缓存的 `_cacache`，不传输本机 node_modules 或用户全局缓存。服务器在该发布目录以部署用户执行 `npm ci --offline --omit=dev --ignore-scripts --no-audit --no-fund --cache <上传的缓存目录>`，由锁文件校验完整性并在服务器安装依赖。此操作不修改全局 registry，也不升级包。

离线安装及模块导入验证通过后，管理员可以使用相同发布包续装：

```bash
sudo bash /absolute/bundle-directory/bootstrap.sh /absolute/bundle-directory --resume-after-deps
```

续装仍检查端口和正式安装路径，逐一核对发布包中的源文件哈希，并验证生产依赖；跳过解压和联网安装。该入口仅处理服务配置之前的依赖阶段失败，不用于一般升级或数据恢复。后续 CI 已改为由 runner 准备离线依赖缓存；实际 Actions 首次部署仍需单独验收，不能由离线安装推断完整自动部署已可用。

### Windows 本地端口与 SSH 隧道

本项目实际遇到 Windows 将 8072–8171 列为 TCP 保留端口，绑定本地 8080 返回 `Permission denied`。因此上述隧道改用本地 18080；服务器 Nginx 仍使用 127.0.0.1:8080，API 仍使用 127.0.0.1:3000。该范围是当时该机器的检查结果，不代表其他机器的端口范围。

在 Windows 本地 PowerShell（不是服务器终端）运行隧道命令，并保持窗口打开；浏览器访问 `http://127.0.0.1:18080/task-board.html`。断开隧道只会中断本地访问，不会停止服务器服务。

排查本地端口时可执行：

```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq 18080
```

后端会校验包含端口的 Host，所以不能只改 SSH 命令而不调整白名单。新版首次安装脚本已包含 `127.0.0.1:18080` 和 `localhost:18080`；旧安装如未包含，管理员应在服务器 `/etc/taskleaf/taskleaf.env` 的 `ALLOWED_HOSTS` 中保留原条目并追加这两项，再执行 `sudo systemctl restart taskleaf`。当前服务器已完成此调整。不要因此开放公网 API 端口或删除 Host 校验。

## 9. 切换公网匿名读写（需要管理员执行）

当前用户明确允许所有人读取和修改全部任务；身份验证、权限控制以后再做。当前服务器已执行并通过外网读取验收；以下步骤用于记录操作，不应在已成功切换的服务器上重复执行。

将 `deploy/enable-public.sh` 与 `deploy/nginx.public.conf.example` 上传到同一目录，在服务器终端执行：

```bash
sudo bash /absolute/upload-directory/enable-public.sh PUBLIC_IPV4 --allow-anonymous-write
```

脚本仅接受首次安装产生的私网配置，备份 Taskleaf 配置到 root 专有目录后，将 Nginx 监听改为 `127.0.0.1:8080` 和服务器主网卡 IPv4:8080 并追加公网 Host。校验配置、重启 Taskleaf、reload Nginx，并用公网 Host 检查页面和健康接口。配置阶段失败时尝试恢复原配置；不恢复或改动任务数据。已启用 UFW 时只增加 TCP 8080 放行规则，不启用或重置防火墙。其他防火墙规则需管理员检查。

云服务器安全组还需要增加 IPv4 入方向：允许 TCP、目标端口 8080、来源 `0.0.0.0/0`。不要为此放行 3000 或改动 SSH 规则。脚本不操作云控制台。完成后从外网访问 `http://PUBLIC_IPV4:8080/task-board.html`，健康接口为 `/api/health`；确认无 SSH 隧道也可访问才算公网验收完成。公网网页也可供匿名用户导出数据，不能作为私密任务库。

原来的本地 18080 隧道仍可继续使用。公网切换不涉及重新构建、数据库或 GitHub 自动部署。首次外网读写验收只使用明确标注的临时测试任务，不改动现有任务。

### 公网切换后仍只有回环监听

`nginx -t` 成功以及 reload 命令返回成功，不代表新监听已经生效。本项目曾出现配置写着 `0.0.0.0:8080`，实际 `ss -ltn` 仍只有 `127.0.0.1:8080` 的情况；当时未取得 Nginx 错误日志，不能仅凭这些信息断定底层原因。

修订模板保留原回环监听，另加主网卡 IPv4 监听，避免由回环切换到重叠通配地址的潜在冲突；通过 `ip -4 route get 1.1.1.1` 获取默认出口源地址，并在写入配置前替换模板占位符 `SERVER_PRIVATE_IPV4`。该方式面向当前单网卡、云公网地址映射的部署环境，多网卡需先人工核对。

脚本 reload 后轮询实际网卡监听，并使用公网 Host 向网卡地址执行 HTTP 健康检查。任一失败即尝试恢复配置，不再只凭回环健康检查报告切换成功。脚本也识别上一版通配监听模板，允许从这一已知失败状态继续修复；不接受任意自定义配置。云安全组和外网验收仍需单独完成。

## 10. 自动部署专用账号与当前进度

采用与 `work`、运行服务的 `taskleaf` 分离的 `taskleaf-deploy` 账号。管理员先审核 `deploy/setup-ci.sh`，再将脚本和专用 Ed25519 **公钥**上传服务器；私钥仅保存在受限本地文件及 GitHub Environment Secret 中，不上传服务器或提交 Git。

```bash
sudo bash /home/work/taskleaf-ci-setup/setup-ci.sh /home/work/taskleaf-ci-setup/deploy_ed25519.pub
```

此路径为本次已经上传的安装材料目录。脚本会：

- 创建锁定密码的部署账号，设置 home 与 `.ssh` 权限为 0700、公钥文件为 0600，并用 `restrict` 禁止密钥的端口转发及 PTY 等功能，保留部署需要的非交互命令。
- 仅授予免密执行 `/usr/bin/systemctl restart taskleaf` 的 sudo 权限，不授予修改 Nginx、防火墙或任意 sudo 权限。
- 只将 `/opt/taskleaf` 和 `/opt/taskleaf/releases` 两个目录本身交给部署账号，不递归更改历史版本、配置、数据和备份权限。
- 不重启现有服务，不切换版本，不修改任务文件。若账号或配置已存在，拒绝覆盖；若中途失败，先检查部分配置再处理，不盲目重跑。

权限边界：部署账号可以替换应用代码，因而其凭据仍能间接影响由服务用户访问的数据；独立账号及精确 sudo 不是对部署代码的沙箱。保护 GitHub 写权限与部署私钥，不把生产环境 Secrets 用于不受信任的 PR。

2026-09-14 准备状态：Environment、五项 Secrets 和关闭状态的部署变量已配置；管理员已执行账号初始化；已用专用密钥及严格主机校验成功登录 taskleaf-deploy，核验发布目录可写、当前代码可读，以及仅允许指定服务重启的 sudo 权限。服务保持 active，回环与公网健康检查通过，公网页面 HTTP 200。未重启服务、切换版本或修改任务。未提交或推送本次代码，未启动首次自动部署。

验证记录：`npm test` 12 项通过，前端构建通过；`tests/deploy.test.sh` 在 Linux 隔离目录覆盖成功、安装失败、模块导入失败、重启失败、健康检查失败回滚及非法版本号共 6 项。Windows Git Bash 的符号链接行为不同，不作为该脚本测试的验收环境。新发布包已在服务器独立临时目录通过 SHA-256 校验、真实离线生产依赖安装及模块导入；没有切换生产版本或修改真实任务。

账号登录、发布目录权限及精确 sudo 权限已验证，但本机 SSH 成功不等同于 GitHub runner 可达。接下来按 `agent.md` 获取 commit、push 与首次部署确认；推送工作流时先保持部署开关关闭，验证 runner SSH 可达性后再启用开关并验收第一次 Actions 发布。启用后，每次 main 推送均会在测试通过后部署。停用自动发布可将仓库变量 `DEPLOY_ENABLED` 改为 `false`，这不停止当前网站。