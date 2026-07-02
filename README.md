# opencode-session-tui

opencode TUI 插件：在右侧栏顶部显示最近 10 个 session，支持点击切换，并对**需要用户处理**和**任务已完成但未查看**的 session 高亮提示。

[![CI](https://github.com/wh0isroot/opencode-session-tui/actions/workflows/ci.yml/badge.svg)](https://github.com/wh0isroot/opencode-session-tui/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/opencode-session-tui.svg)](https://www.npmjs.com/package/opencode-session-tui)

## 效果

在会话页的右侧栏 `sidebar_content` 位置渲染：

```
Sessions
? 1. refactor auth module           ← 有 question 等待回答（粗体，warning 色）
! 2. deploy staging                 ← 有 permission 等待确认（粗体，warning 色）
⏵ 3. run test suite                 ← 正在运行（accent 色）
↻ 4. summarize PR                   ← 正在重试（warning 色）
• 5. fix flaky test                 ← 已完成但你还没看（粗体，success 色）
  6. update docs                    ← 当前正在查看（accent 色）
  7. cleanup logs                   ← 普通空闲状态（muted）
  ...
```

- 图标：`?` question / `!` permission / `⏵` busy / `↻` retry / `•` unread-done / 空白 idle
- 当前 session：accent 色 + 粗体
- 需要注意的 session（question / permission / unread）：粗体 + 显眼色
- 鼠标左键点击任意行即可切换到该 session

## 状态判定

判定优先级（高→低）：`question` > `permission` > `busy` > `retry` > `unread` > `idle`

- `question` / `permission`：读 [`api.state.session.question(id)`](src/index.tsx) / `api.state.session.permission(id)`（响应式）
- `busy` / `retry` / `idle`：读 `api.state.session.status(id)`
- `unread`（任务完成但未查看）：插件本地维护
  - 触发：`session.status` 事件里 `busy|retry → idle`，且当时用户查看的**不是**这个 session
  - 清除：用户导航进入该 session
  - 持久化：通过 `api.kv` 存储（详见 `UNREAD_KV_KEY`），TUI 重启后仍然保留

参见 [`src/index.tsx`](src/index.tsx) 的 `classify` 与 `markerFor` 函数。

## 安装

opencode 只在 `sidebar_content` 里给插件一个渲染槽（外层 42 列面板由宿主渲染，不可替换）。所以本插件是把内容注入到这个槽里。

### 方式 A：npm 包（推荐）

编辑 opencode TUI 配置，用户级 `~/.config/opencode/tui.json` 或项目级 `<project>/.opencode/tui.json`：

```json
{
  "plugin": ["opencode-session-tui"]
}
```

opencode 会自动 `npm install` 拉取并加载此包。

### 方式 B：本地文件（开发调试）

1. clone 本仓库到任意路径，例如 `~/code/opencode-session-tui`。
2. 编辑 `tui.json`：

   ```json
   {
     "plugin": [
       "file:///home/YOU/code/opencode-session-tui/src/index.tsx"
     ]
   }
   ```

3. 重启 opencode TUI。首次加载时 opencode 会自动为插件目录安装 `@opencode-ai/plugin`；`solid-js` 从宿主 node_modules 解析。

### 方式 C：放到默认插件目录

opencode 会自动扫描以下目录里的插件模块：

- 项目级：`<project>/.opencode/plugins/`
- 全局级：`~/.config/opencode/plugins/`

例如：

```bash
git clone https://github.com/wh0isroot/opencode-session-tui.git \
  ~/.config/opencode/plugins/opencode-session-tui
```

### 验证插件已加载

在 opencode TUI 里打开命令面板搜索 `Plugins`，可以看到 `opencode-session-tui` 处于 `active`。切进任意 session，右侧栏顶部就会出现 `Sessions` 列表。

## 开发

```bash
bun install
bun run typecheck
```

## 发布流程

1. 提 PR，等 [CI](.github/workflows/ci.yml) 通过（`bun run typecheck`）。
2. bump `package.json` 的 `version`。
3. 打 tag：`git tag v0.1.0 && git push origin v0.1.0`。
4. [`publish.yml`](.github/workflows/publish.yml) 会在 tag 匹配 `package.json` 版本时自动 `npm publish --provenance`。
5. 需要在仓库 Settings → Secrets and variables → Actions 里配置 `NPM_TOKEN`。

## 已知边界

- 只在**会话页**渲染。opencode 主页不渲染右侧栏，也就看不到此列表。这不是 bug——宿主布局如此，切换到 home 时用内置的 session 列表对话框即可。
- 只列 root session（`parentID` 为空），忽略 subagent 分支。
- SDK 类型里目前**没有** `lastReadAt` / `unread` 字段。本插件的 `unread` 是本地推断（`busy → idle` 且不在当前查看），不是服务端语义。

## 相关代码位置（opencode 主仓）

- 插件 API 类型：[`packages/plugin/src/tui.ts`](https://github.com/sst/opencode/blob/main/packages/plugin/src/tui.ts)
- 侧栏 slot：`sidebar_content` in [`packages/tui/src/routes/session/sidebar.tsx`](https://github.com/sst/opencode/blob/main/packages/tui/src/routes/session/sidebar.tsx)
- 官方参考实现（context 卡片）：[`packages/tui/src/feature-plugins/sidebar/context.tsx`](https://github.com/sst/opencode/blob/main/packages/tui/src/feature-plugins/sidebar/context.tsx)
- 内置 session 切换对话框：[`packages/tui/src/component/dialog-session-list.tsx`](https://github.com/sst/opencode/blob/main/packages/tui/src/component/dialog-session-list.tsx)

## License

[MIT](LICENSE)
