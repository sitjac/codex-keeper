# Codex Keeper 开机自启

`npm run serve` 在启动本地服务前，已经会先执行 `build:runtime` 和 `web:build`。对这个仓库来说，在 Linux 上最稳妥的开机自启方案是使用 `systemd --user` 服务来调用 `scripts/start-serve.sh`。

## 为什么这样设计

- 包装脚本在执行 `npm run serve` 之前，总是会先进入仓库根目录。
- 包装脚本在检测到 `nvm` 可用时会先加载它，避免系统重启后 `systemd` 找不到 `node` 或 `npm` 的常见问题。
- 包装脚本不会调用 `nvm use`，所以即使仓库里没有 `.nvmrc` 也能正常工作。
- `systemd --user` 可以在服务异常退出后自动拉起，并且日志会保存在 `journalctl` 中。

## 前置条件

- 先在仓库目录执行一次 `npm install`。
- 确认当前用户已经安装 Node.js `>= 20` 和 npm `>= 10`。

## 安装服务

1. 创建用户级 systemd 服务目录：

   ```bash
   mkdir -p ~/.config/systemd/user
   ```

2. 将示例服务文件复制到对应位置：

   ```bash
   cp /home/xiejunjie/Work/PersonalCodes/Github/codex-keeper/scripts/codex-keeper.service.example \
     ~/.config/systemd/user/codex-keeper.service
   ```

3. 给启动脚本添加可执行权限：

   ```bash
   chmod +x /home/xiejunjie/Work/PersonalCodes/Github/codex-keeper/scripts/start-serve.sh
   ```

4. 重新加载配置并立即启动服务：

   ```bash
   systemctl --user daemon-reload
   systemctl --user enable --now codex-keeper.service
   ```

5. 如果你希望机器刚开机时就启动，而不是等你登录后才启动，可以额外执行一次：

   ```bash
   loginctl enable-linger xiejunjie
   ```

## 常用操作

- 查看状态：

  ```bash
  systemctl --user status codex-keeper.service
  ```

- 实时查看日志：

  ```bash
  journalctl --user -u codex-keeper.service -f
  ```

- 代码更新后重启服务：

  ```bash
  systemctl --user restart codex-keeper.service
  ```

- 关闭开机自启并停止服务：

  ```bash
  systemctl --user disable --now codex-keeper.service
  ```

## 可选覆盖配置

如果你想让服务监听其他主机地址或端口，可以编辑 `~/.config/systemd/user/codex-keeper.service`，修改 `ExecStart`，例如：

```ini
ExecStart=%h/Work/PersonalCodes/Github/codex-keeper/scripts/start-serve.sh --host 0.0.0.0 --port 42110
```

修改后重新加载并重启：

```bash
systemctl --user daemon-reload
systemctl --user restart codex-keeper.service
```

## 兜底方案

如果当前环境无法使用 `systemd --user`，可以退而求其次用 `crontab @reboot`，但它在日志记录和异常自动恢复方面都更弱。在 Ubuntu 上优先使用 `systemd --user`。
