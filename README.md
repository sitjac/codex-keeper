# codex-keeper

本项目是一个本地优先的 Codex session 管理器，用来浏览、重命名和删除本机 Codex 会话，并让 UI 中的 session 名称和 Codex CLI `/resume` 中看到的名称保持一致。

当前版本聚焦在会话管理本身：推荐使用 Web UI 进行手动重命名、按工作区查看历史会话，以及阅读整理后的 Codex 对话内容。

![Language: TypeScript](https://img.shields.io/static/v1?label=Language&message=TypeScript&color=3178c6&style=flat-square)
![Node 20+](https://img.shields.io/static/v1?label=Node&message=20%2B&color=43853d&style=flat-square)
![Local-first](https://img.shields.io/static/v1?label=Mode&message=Local-first&color=2563eb&style=flat-square)
![License: MIT](https://img.shields.io/static/v1?label=License&message=MIT&color=2563eb&style=flat-square)

## 主要功能

- **按工作区分组 session**：左侧先展示工作区数量和 session 总数，每个工作区可折叠或展开，避免多个项目的会话混在一起。
- **只显示 session 名称**：会话列表保留标题本身，不再展示第一轮对话内容，减少干扰。
- **手动重命名**：在会话详情顶部点击标题即可编辑，保存后立即刷新 UI。
- **同步 Codex CLI**：重命名会写回 Codex 使用的 session 索引和本地状态，目标是让 Codex CLI `/resume` 中显示同一个名称。
- **删除 session**：在会话列表的更多菜单中删除会话，并同步清理本地索引和状态，避免 UI 数量和 Codex 侧数量不一致。
- **阅读友好的 transcript**：会话内容按用户输入和 Codex 输出组织，屏蔽不必要的内部输入输出，阅读逻辑更接近 Codex CLI。

## 快速开始

```bash
git clone https://github.com/sitJac/codex-keeper.git
cd codex-keeper
npm install
npm run serve
```

启动后打开：

```text
http://127.0.0.1:42110
```

`npm run serve` 会构建运行时和 Web UI，然后启动本地 API 服务。默认只绑定 `127.0.0.1`。

## 基本使用

1. 打开 Web UI 后，左侧会按工作区展示本机 Codex sessions。
2. 点击工作区名称可折叠或展开该工作区下的会话。
3. 点击某个 session 后，右侧展示整理后的对话内容。
4. 点击右侧顶部的 session 名称可直接重命名。
5. 在 session 行右侧的更多菜单中可以复制 session id 或删除 session。
6. 修改后回到 Codex CLI 执行 `/resume`，应能看到同步后的 session 名称。

## 写回机制

项目不会修改 Codex 源码。重命名和删除会围绕 Codex 本地会话数据做同步：

- 更新 `~/.codex/session_index.jsonl` 中对应 session 的名称记录。
- 在 rollout 文件中补充 `thread_name_updated` 事件，用于保留名称变更历史。
- 更新 Codex 本地状态库中的 thread 标题，使 Codex CLI `/resume` 和 Web UI 尽量保持一致。
- 删除 session 时同步清理本地索引、rollout 和项目自己的状态库记录。

如果 UI 和 Codex CLI 的显示不一致，优先检查该 session 是否来自同一个 workspace，以及本地 Codex 状态文件是否可写。

## 命令

常用命令：

```bash
npm run serve
npm run web
npm run api
npm run cli -- list
npm run cli -- show --id <threadId>
npm run cli -- rename --id <threadId> --name "新的 session 名称"
```

开发验证：

```bash
npm run lint
npm run build
npm run web:build
npm test
```

完整检查：

```bash
npm run validate:full
```

## 项目结构

```text
packages/core     Codex 会话扫描、索引、写回和状态管理
packages/shared   API、Web、CLI 共用的类型和 schema
packages/api      本地 HTTP API
packages/cli      命令行入口和 serve 启动器
packages/web      Web UI
test              Vitest 回归测试
docs              当前设计说明
scripts           开发辅助脚本
```

## 设计取向

codex-keeper 只做本地会话管理，不接管 Codex 本身。当前主线优先保证三件事：session 名称可手动维护、工作区内的会话清晰可读、UI 和 Codex CLI 看到的状态一致。
