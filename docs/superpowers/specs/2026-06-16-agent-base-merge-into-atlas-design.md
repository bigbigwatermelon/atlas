# Agent App 底座合并到 Atlas 主干设计

## 背景

当前 `main` 已完成 Atlas 产品身份迁移，关键提交为 `a69a981 feat: migrate product identity to Atlas`。该迁移要求源码、运行时、协议、资产、文档和默认数据路径都只使用 Atlas 身份，不再读取、生成或接受旧产品身份。

此前 `agent-app-decoding-spec` 分支完成过一轮通用 Agent App 底座化，最后可定位提交为 `0e6833383538beea0406821c346d2808e266ee7a`。这条线从 `30d5c4b6a329e944b3e326c23d7712f18ef39feb` 分叉，早于 Atlas 身份迁移，因此旧提交中仍包含旧产品 home 环境变量、旧 home 目录、旧 Rust crate 名、旧 MCP server 名、旧 sentinel namespace 和旧用户可见产品名。

## 目标

以当前 `main` 为唯一基准，把 `agent-app-decoding-spec` 的通用底座化语义补回 Atlas 主干，同时保持 Atlas 身份迁移的效果不被还原。

完成后应满足：

- 默认产品路径是 `workspace -> task -> run`，普通 task/run 不要求 repo、git worktree、diff、PR 或 pre-PR checks。
- `main` 上已有的 Atlas 身份保持完整，包括 `ATLAS_HOME`、`~/.atlas`、`atlas_app_lib`、`atlas_bus`、`atlas_planner`、`atlas_global`、Atlas 资产和 Atlas 文案。
- 旧底座化分支中仍有价值的行为被移植成 Atlas 版本，而不是原样合并旧命名。
- legacy coding 能力可以保留在源码中，但不能作为默认 onboarding、workspace home、task/run、lead prompt 或 command palette 的主路径。
- 合并结果有自动化验证和静态身份扫描证据。

## 非目标

- 不把 `codex/native-swift-macos-migration` 合入本轮范围。
- 不恢复旧产品身份，也不提供旧产品到 Atlas 的兼容桥。
- 不做数据迁移或旧数据库兼容。
- 不删除 legacy repo/worktree/diff 模块，除非它们已经被默认路径错误引用。
- 不引入 HR、Pack、Scenario 或新的业务领域模型。

## 推荐方案

采用语义移植，不采用机械 merge。

从 `main` 新开审计分支，例如 `codex/merge-agent-base-into-atlas`。把 `0e68333` 旧分支视为参考实现，逐项对照其 13 个底座化提交：

1. `main` 已经有且 Atlas 化正确的能力，保持 `main` 版本。
2. `main` 已经有但行为不完整的能力，在当前 Atlas 命名下补齐。
3. 旧分支有而 `main` 缺失的能力，按 Atlas 身份重写后移植。
4. 任何会引入旧产品身份的改动都禁止进入最终 diff。

不推荐 `git merge 0e68333` 或整段 cherry-pick 旧提交。旧提交跨越的文件和 Atlas 迁移高度重叠，原样合入会把旧命名、旧资产、旧运行目录或旧文案带回来。

## 需要审计的能力面

后端路径：

- `src-tauri/src/paths.rs`：确认 `run_home` 使用 `atlas_home()` 和 `~/.atlas/workspaces/<workspace>/tasks/<task>/runs/<run>`。
- `src-tauri/src/commands.rs`：确认 `create_run` 创建 repo-less run，`session_for` 对 `repo_id = 0` 返回 app-managed cwd，不要求 worktree。
- `src-tauri/src/lead_chat/commands.rs`：确认 lead 默认 prompt 使用 task/run 语义，不注入 repo map，不默认要求 propose repo directions。
- `src-tauri/src/brief.rs`：确认 generic brief 不含 repo/worktree/diff/PR/check 默认契约。
- `src-tauri/src/bus/server.rs`：确认默认 planner 工具以 `get_task` 为核心，不把 repo map 当默认上下文。
- `src-tauri/src/store/repo.rs`：确认 repo-less direction/session 的回归测试覆盖 `repo_id = 0`。
- `src-tauri/src/lib.rs`：确认 Tauri command 注册包含 Atlas 版本的 run/session 入口。

前端路径：

- `src/board/WorkspaceHome.tsx`、`src/board/ThreadBoard.tsx`：默认首页和 task detail 不引导 add repo、repo map、scope review 或 diff。
- `src/nav/WorkspaceNav.tsx`、`src/nav/AppTopBar.tsx`、`src/components/CommandPalette.tsx`：默认导航和命令 palette 使用 task/run 文案。
- `src/nav/dialogs.tsx`：创建入口是 task，而不是 repo-first issue。
- `src/session/SessionView.tsx`、`src/session/ObserveView.tsx`、`src/session/LeadTab.tsx`：repo-less run 可以打开 chat/observe，diff 入口只在 legacy coding 场景出现。
- `src/state/store.tsx`、`src/lib/api.ts`、`src/lib/types.ts`：前端 API 包装和状态流支持 `createRun`、`chatOpenRun` 和 repo-less cwd。
- `src/i18n/en.ts`、`src/i18n/zh.ts`：用户可见默认路径使用 task/run/Atlas 文案，不回到旧产品名或 coding-first 文案。

身份守卫：

- 禁止新增旧产品 home 环境变量、旧 home 目录、旧 Rust crate 名、旧 MCP server 名、旧 sentinel namespace、旧 public asset 名和旧 README asset 名。
- 禁止用户可见默认 UI 出现旧产品名。
- 历史文档中如果必须引用旧身份，只能在 Atlas 身份迁移文档中作为“旧身份”说明出现；本轮底座合并文档和实现不应新增旧身份字面量。

## 数据流

用户创建 workspace 后创建 task。task 默认通过 `createRun` 生成一个 repo-less run，后端以 `repo_id = 0` 表示不绑定 repository。打开 run 时，后端通过 `atlas_home()/workspaces/<workspace>/tasks/<task>/runs/<run>` 生成 cwd，技能注入、provider 会话、timeline 和 permission ask 都绑定到该 run cwd。

如果用户进入 legacy coding 功能，repo/worktree/diff 仍可作为显式能力存在。但普通 task/run 不应自动物化 worktree，不应自动展示 diff，也不应把 PR/checks 作为完成标准。

## 错误处理

- run cwd 创建失败时，创建或打开 run 应返回明确错误，并包含安全的路径上下文。
- repo-less session 查不到 task、workspace 或 run 时，应返回用户可理解的错误，不 fallback 到 repo/worktree。
- provider 启动失败时，timeline 记录错误，run 状态保持可恢复。
- 旧身份扫描失败时，视为阻塞合并的问题，不通过验证。

## 验证策略

最小自动化验证：

- `git diff --check`
- `pnpm build`
- `pnpm preflight:quick`
- 聚焦 Rust 测试：
  - `cd src-tauri && cargo test paths::tests::run_home --lib`
  - `cd src-tauri && cargo test brief::tests::generic_run_brief_has_no_repo_or_check_contract --lib`
  - `cd src-tauri && cargo test bus::server::planner_tests::planner_specs_expose_generic_task_tools_only --lib`
  - `cd src-tauri && cargo test repo_less_direction_can_back_a_generic_session`

身份验证：

- 运行现有 `scripts/verify-atlas-identity.sh`。
- 对本轮变更文件执行旧身份扫描，确认没有旧 home 环境变量、旧 home 目录、旧 Rust crate 名、旧 MCP server 名或旧用户可见产品名回流。

实机验证：

- 使用 fresh `ATLAS_HOME` 启动当前代码。
- 创建 workspace。
- 创建 task。
- 启动默认 run。
- 确认进入 chat/run 路径，而不是 repo onboarding、repo map、scope review 或 diff。
- 确认页面标题、图标、可见文案仍为 Atlas。

## 风险与缓解

主要风险是把旧分支按 Git 提交原样合入，导致 Atlas 身份局部回退。缓解方式是只做语义移植，并把旧身份扫描作为阻塞验证。

第二个风险是 `main` 已经包含部分底座化能力，重复移植会引入重复 API、重复文案或状态流分叉。缓解方式是先审计 `main` 现状，只补行为缺口。

第三个风险是隐藏入口仍然保留 coding-first 默认假设。缓解方式是覆盖导航、command palette、onboarding、lead prompt、brief、session surface 和 i18n，而不是只改 workspace 首页。

## 交付顺序

1. 建立 main-based 审计分支。
2. 对照旧底座化提交，列出 `main` 已有能力和缺口。
3. 先修身份安全风险，再补行为缺口。
4. 分段运行窄测试和身份扫描。
5. 完成后运行前端 build、quick preflight、必要 Rust 测试和实机 fresh `ATLAS_HOME` 验证。
6. 若后续创建 PR，PR body 必须说明：不是机械合并旧分支，而是 Atlas-safe semantic port。
