# Atlas-Safe Agent Base Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the generic Agent App task/run default path on top of current `main` while preserving the Atlas product identity migration.

**Architecture:** Treat `0e6833383538beea0406821c346d2808e266ee7a` as a reference implementation, not as a merge target. Keep the existing Atlas backend run primitives, remove repo-first entry points from the default UI, allow repo-less observe/session paths, and add a default-path verifier that blocks future regressions. Legacy repo/worktree/diff surfaces can remain in source, but they must not be reachable from the default workspace/task route.

**Tech Stack:** Tauri v2, Rust 2021, SeaORM/SQLite, React 19, TypeScript, Vite, pnpm, Node.js verification scripts.

---

## Scope Check

This is one implementation track: semantic-port the generic task/run default path into Atlas. It does not include the native Swift/macOS migration branch, data migration, old identity compatibility, or removal of legacy coding modules.

## File Structure

- Create: `scripts/verify-agent-base-defaults.mjs`
  - Responsibility: fail fast when the default Atlas task/run route exposes repo-first UI, repo-less observe is disabled, or old identity markers return.
- Modify: `scripts/preflight.sh`
  - Responsibility: run the new default-path verifier after the Atlas identity verifier.
- Modify: `src/nav/WorkspaceNav.tsx`
  - Responsibility: remove Add repo and Repo map from the default sidebar route while preserving task/workspace/settings navigation.
- Modify: `src/session/ObserveView.tsx`
  - Responsibility: let repo-less runs render observe/session state instead of returning `null`.
- Modify: `src/i18n/en.ts`
  - Responsibility: replace default onboarding/task/run copy that still describes repo map, worktrees, sub-tasks, issues, or PR-style delivery.
- Modify: `src/i18n/zh.ts`
  - Responsibility: Chinese equivalent of the English default-path copy cleanup.

## Task 1: Add The Default-Path Verifier

**Files:**
- Create: `scripts/verify-agent-base-defaults.mjs`

- [ ] **Step 1: Create the verifier script**

Create `scripts/verify-agent-base-defaults.mjs` with this exact content:

```js
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const failures = [];

function read(path) {
  return readFileSync(path, "utf8");
}

function gitGrep(pattern) {
  try {
    return execFileSync("git", ["grep", "-I", "-n", "-E", pattern, "--", "."], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 1) {
      return "";
    }
    throw error;
  }
}

function fail(message) {
  failures.push(message);
}

function forbidRegex(file, regex, message) {
  const text = read(file);
  if (regex.test(text)) {
    fail(`${file}: ${message}`);
  }
}

function forbidPhrase(file, phrase, message) {
  const text = read(file);
  if (text.includes(phrase)) {
    fail(`${file}: ${message}`);
  }
}

const oldLower = ["w", "e", "f", "t"].join("");
const oldUpper = oldLower.toUpperCase();
const oldPascal = `${oldLower[0].toUpperCase()}${oldLower.slice(1)}`;
const oldIdentityPattern = [
  `${oldUpper}_`,
  `${oldLower}_bus`,
  `${oldLower}_planner`,
  `${oldLower}_global`,
  `mcp__${oldLower}`,
  `${oldLower}_app_lib`,
  `${oldLower}-app`,
  `${oldLower}-mark\\.svg`,
  `${oldLower}-(icon|logo|mark)\\.svg`,
  `${oldLower}\\.db`,
  `~/.${oldLower}`,
  `com\\.jingchen\\.${oldLower}`,
  `(^|[^[:alnum:]_])${oldPascal}([^[:alnum:]_]|$)`,
].join("|");

const oldIdentityMatches = gitGrep(oldIdentityPattern);
if (oldIdentityMatches) {
  fail(`Old product identity markers remain:\n${oldIdentityMatches}`);
}

forbidRegex(
  "src/nav/WorkspaceNav.tsx",
  /AddRepoDialog|FolderPlus|FolderGit2|setDlg\("repo"\)|workspace\.tabRepos/,
  "default sidebar must not expose Add repo or Repo map",
);
forbidRegex(
  "src/session/ObserveView.tsx",
  /if\s*\(\s*viewing\.repoId\s*===\s*0\s*\)\s*return\s+null\s*;/,
  "repo-less runs must render the observe/session surface",
);
forbidRegex(
  "src/components/CommandPalette.tsx",
  /palette\.repos|openRepoMap|nav-repos/,
  "command palette must not expose repo map as a default route",
);

forbidPhrase("src/i18n/en.ts", "Add repos · Curator profiles them", "onboarding still starts from repos");
forbidPhrase("src/i18n/en.ts", "Dependency graph forms automatically", "onboarding still teaches repo graph first");
forbidPhrase("src/i18n/en.ts", "Lead decomposes cross-repo scope", "onboarding still teaches cross-repo scope first");
forbidPhrase("src/i18n/en.ts", "Turn one task into deliverable multi-repo work", "onboarding still presents coding delivery as the product");
forbidPhrase("src/i18n/en.ts", "Repo map to scope", "onboarding preview still centers repo map");
forbidPhrase("src/i18n/en.ts", "Talk to the lead to plan this issue", "task empty copy still says issue");
forbidPhrase("src/i18n/en.ts", "The lead reads your repos", "task empty copy still assumes repos");
forbidPhrase("src/i18n/en.ts", "sub-task · runs in parallel", "thread copy still says sub-task");
forbidPhrase("src/i18n/en.ts", "Run this sub-task's checks", "review copy still says sub-task checks by default");

forbidPhrase("src/i18n/zh.ts", "添加仓库 · Curator 自动盘点", "中文 onboarding 仍以仓库开始");
forbidPhrase("src/i18n/zh.ts", "依赖图自动成形", "中文 onboarding 仍先讲依赖图");
forbidPhrase("src/i18n/zh.ts", "Lead 跨仓拆解 scope", "中文 onboarding 仍先讲跨仓 scope");
forbidPhrase("src/i18n/zh.ts", "把一个 Task 拆成可交付的多仓工作", "中文 onboarding 仍把多仓交付作为产品默认");
forbidPhrase("src/i18n/zh.ts", "从仓库地图到 scope", "中文 preview 仍以仓库地图为中心");
forbidPhrase("src/i18n/zh.ts", "规划这个 issue", "中文任务空态仍说 issue");
forbidPhrase("src/i18n/zh.ts", "读取你的仓库", "中文任务空态仍假设仓库");
forbidPhrase("src/i18n/zh.ts", "个子任务 · 并行执行", "中文 thread copy 仍说子任务");
forbidPhrase("src/i18n/zh.ts", "运行该子任务的检查", "中文 review copy 仍说子任务检查");

if (failures.length > 0) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}

console.log("Agent base default-path checks passed.");
```

- [ ] **Step 2: Run the verifier and confirm it fails on current `main`**

Run:

```bash
node scripts/verify-agent-base-defaults.mjs
```

Expected: FAIL. The output must include at least `src/nav/WorkspaceNav.tsx` and `src/i18n/en.ts` or `src/i18n/zh.ts`, proving the guard catches current repo-first default-route remnants.

Do not commit yet. The verifier is intentionally red until Tasks 2 and 3 land.

## Task 2: Remove Repo-First Sidebar Entry Points

**Files:**
- Modify: `src/nav/WorkspaceNav.tsx`

- [ ] **Step 1: Remove repo-only icons and dialog imports**

In `src/nav/WorkspaceNav.tsx`, change the lucide import from:

```ts
import {
  Check,
  ChevronDown,
  FolderGit2,
  FolderPlus,
  HelpCircle,
  LayoutGrid,
  Pencil,
  Plus,
  Search,
  Settings,
  SquarePen,
  Trash2,
} from "lucide-react";
```

to:

```ts
import {
  Check,
  ChevronDown,
  HelpCircle,
  LayoutGrid,
  Pencil,
  Plus,
  Search,
  Settings,
  SquarePen,
  Trash2,
} from "lucide-react";
```

Change the dialog import from:

```ts
import { AddRepoDialog, CreateThreadDialog, CreateWorkspaceDialog, RenameDialog } from "./dialogs";
```

to:

```ts
import { CreateThreadDialog, CreateWorkspaceDialog, RenameDialog } from "./dialogs";
```

- [ ] **Step 2: Remove repo from the sidebar dialog state**

Replace:

```ts
const [dlg, setDlg] = useState<null | "ws" | "repo" | "thread">(null);
```

with:

```ts
const [dlg, setDlg] = useState<null | "ws" | "thread">(null);
```

- [ ] **Step 3: Remove the Add repo primary action**

Delete this button block from the active-workspace primary actions:

```tsx
<button
  onClick={() => setDlg("repo")}
  className="flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-[13px] text-ink-muted transition-colors hover:bg-brand-ghost hover:text-ink"
>
  <FolderPlus size={14} className="text-ink-faint" />
  {t("dialog.addRepo")}
</button>
```

The primary actions section should contain only the new task button:

```tsx
<div className="flex flex-col gap-0.5 px-2 py-1">
  <button
    onClick={() => setDlg("thread")}
    className="flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-brand-ghost"
  >
    <SquarePen size={14} className="text-brand" />
    {t("nav.newThread")}
  </button>
</div>
```

- [ ] **Step 4: Remove the Repo map home tab from the default rail**

Delete this `WsNavItem` from the workspace views list:

```tsx
<WsNavItem
  icon={FolderGit2}
  label={t("workspace.tabRepos")}
  active={onHome && homeTab === "repos"}
  onClick={() => {
    backToWorkspace();
    setHomeTab("repos");
  }}
/>
```

Keep the Needs-you and Board items:

```tsx
<ul className="flex flex-col gap-0.5 px-2 py-1">
  <WsNavItem
    icon={HelpCircle}
    label={t("needs.title")}
    attnCount={needsCount}
    active={showNeeds}
    onClick={() => openNeeds()}
  />
  <WsNavItem
    icon={LayoutGrid}
    label={t("thread.tabBoard")}
    active={onHome && homeTab === "board"}
    onClick={() => {
      backToWorkspace();
      setHomeTab("board");
    }}
  />
</ul>
```

- [ ] **Step 5: Remove the Add repo dialog mount**

Delete:

```tsx
<AddRepoDialog open={dlg === "repo"} onOpenChange={(o) => !o && setDlg(null)} />
```

- [ ] **Step 6: Run TypeScript build**

Run:

```bash
pnpm build
```

Expected: PASS. If it fails with unused imports or impossible `dlg` comparisons, fix only `src/nav/WorkspaceNav.tsx` until the build passes.

## Task 3: Restore Repo-Less Observe And Generic Default Copy

**Files:**
- Modify: `src/session/ObserveView.tsx`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh.ts`

- [ ] **Step 1: Allow repo-less observe rendering**

In `src/session/ObserveView.tsx`, delete this early return:

```ts
if (viewing.repoId === 0) return null;
```

Do not change `canShowDiff`; it already prevents diff from showing for repo-less runs:

```ts
const canShowDiff = !!ref && repoId !== 0 && ref.branch.trim() !== "";
```

- [ ] **Step 2: Replace English default onboarding copy**

In `src/i18n/en.ts`, update these `onboarding` values exactly:

```ts
addReposTitle: "Optional coding context",
addReposBody: "Add repositories only when a task explicitly needs code context.",
graphTitle: "Context stays attached to the task",
graphBody: "Atlas keeps chat, runs, skills, and permission requests together without requiring a repository.",
scopeTitle: "Runs stay focused",
scopeBody: "Start one general run, then add specialized runs only when the task needs them.",
title: "Turn one task into focused local agent runs",
body: "Start with one task. Atlas keeps chat, runs, skills, and permission requests in one local workspace.",
stepRepos: "Create a task",
stepReposBody: "Describe the outcome you want. No repository is required.",
stepMap: "Start a run",
stepMapBody: "Choose a provider and keep the run attached to the task.",
stepIssue: "Coordinate progress",
stepIssueBody: "The coordinator keeps context and asks when it needs your decision.",
localOnly: "Local-first · no server · task context stays on this machine",
previewTitle: "Task to run",
previewHint: "The default Atlas workflow",
scopePreview: "focused run attached to the task",
```

- [ ] **Step 3: Replace English thread default copy**

In `src/i18n/en.ts`, update these `thread` values exactly:

```ts
directionsSub_one: "{{count}} run",
directionsSub_other: "{{count}} runs",
runChecks: "Run checks for this coding run",
reviewTip: "Run the global review skill inside this run's session",
renameTask: "Rename run",
discussTitle: "Talk to the coordinator to plan this task",
discussBody:
  "Describe what you want in chat. The coordinator keeps context, answers directly when it can, and helps start focused runs when useful.",
```

- [ ] **Step 4: Remove duplicate English keys while touching the section**

In `src/i18n/en.ts`, the `lead` object currently declares `title` twice. Keep only one:

```ts
lead: {
  title: "Coordinator",
  start: "Start coordinator",
```

- [ ] **Step 5: Replace Chinese default onboarding copy**

In `src/i18n/zh.ts`, update these `onboarding` values exactly:

```ts
addReposTitle: "可选的代码上下文",
addReposBody: "只有当任务明确需要代码上下文时，才添加仓库。",
graphTitle: "上下文跟随任务",
graphBody: "Atlas 会把对话、运行、skills 和权限请求绑定到任务，不要求先有仓库。",
scopeTitle: "运行保持聚焦",
scopeBody: "先启动一个通用运行；只有任务需要时，再添加更专门的运行。",
title: "把一个任务推进为本地 Agent 运行",
body: "从一个任务开始。Atlas 会在本地工作区里管理对话、运行、skills 和权限请求。",
stepRepos: "创建任务",
stepReposBody: "描述你想要的结果，不需要仓库。",
stepMap: "启动运行",
stepMapBody: "选择 provider，并把运行保留在这个任务下。",
stepIssue: "协调进展",
stepIssueBody: "协调者保留上下文，能直接回答就直接回答，需要你决定时再提问。",
localOnly: "本地优先 · 无服务端 · 任务上下文留在本机",
previewTitle: "从任务到运行",
previewHint: "Atlas 的默认工作流",
scopePreview: "绑定在任务下的聚焦运行",
```

- [ ] **Step 6: Replace Chinese thread default copy**

In `src/i18n/zh.ts`, update these `thread` values exactly:

```ts
directionsSub_one: "{{count}} 个运行",
directionsSub_other: "{{count}} 个运行",
runChecks: "运行该代码运行的检查",
reviewTip: "在该运行的会话里运行全局 review skill",
renameTask: "重命名运行",
discussTitle: "和协调者聊聊来规划这个任务",
discussBody:
  "在对话里描述你想要什么。协调者会保留上下文，能直接回答就直接回答，并在需要时帮助启动聚焦运行。",
```

- [ ] **Step 7: Remove duplicate Chinese keys while touching the section**

In `src/i18n/zh.ts`, the `lead` object currently declares `attachFile` twice. Keep only one:

```ts
lead: {
  title: "协调者",
  start: "启动协调者",
  compose: "给协调者发消息…",
  attachFile: "@ 文件",
```

- [ ] **Step 8: Run the verifier again**

Run:

```bash
node scripts/verify-agent-base-defaults.mjs
```

Expected: PASS with:

```text
Agent base default-path checks passed.
```

- [ ] **Step 9: Run TypeScript build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 10: Commit default path changes and verifier**

Run:

```bash
git add scripts/verify-agent-base-defaults.mjs \
  src/nav/WorkspaceNav.tsx \
  src/session/ObserveView.tsx \
  src/i18n/en.ts \
  src/i18n/zh.ts
git commit -m "fix(ui): restore Atlas task run default path"
```

Expected: one commit containing the verifier and the UI/copy changes. Do not stage `native/AtlasNative/.build`.

## Task 4: Wire The Verifier Into Preflight

**Files:**
- Modify: `scripts/preflight.sh`

- [ ] **Step 1: Hook the verifier after the Atlas identity check**

In `scripts/preflight.sh`, replace:

```bash
run scripts/verify-atlas-identity.sh
run pnpm build
run cargo "${rust_args[@]}"
```

with:

```bash
run scripts/verify-atlas-identity.sh
run node scripts/verify-agent-base-defaults.mjs
run pnpm build
run cargo "${rust_args[@]}"
```

- [ ] **Step 2: Run the two identity/default guards**

Run:

```bash
scripts/verify-atlas-identity.sh
node scripts/verify-agent-base-defaults.mjs
```

Expected:

```text
Agent base default-path checks passed.
```

`scripts/verify-atlas-identity.sh` is quiet on success.

- [ ] **Step 3: Commit the preflight hook**

Run:

```bash
git add scripts/preflight.sh
git commit -m "chore: guard Atlas agent base defaults"
```

Expected: one commit touching only `scripts/preflight.sh`.

## Task 5: Run Backend Regression Checks

**Files:**
- Verify: `src-tauri/src/paths.rs`
- Verify: `src-tauri/src/commands.rs`
- Verify: `src-tauri/src/lead_chat/commands.rs`
- Verify: `src-tauri/src/brief.rs`
- Verify: `src-tauri/src/bus/server.rs`
- Verify: `src-tauri/src/store/repo.rs`
- Verify: `src-tauri/tests/lead_prompt.rs`

- [ ] **Step 1: Run focused path tests**

Run:

```bash
cd src-tauri && cargo test paths::tests::run_home --lib
```

Expected: PASS. This confirms run homes use Atlas home and reject unsafe path segments.

- [ ] **Step 2: Run focused brief tests**

Run:

```bash
cd src-tauri && cargo test brief::tests::generic_run_brief_has_no_repo_or_check_contract --lib
```

Expected: PASS. This confirms generic run briefs do not require repo writes, checks, or PR language.

- [ ] **Step 3: Run focused planner-tool tests**

Run:

```bash
cd src-tauri && cargo test bus::server::planner_tests::planner_specs_expose_generic_task_tools_only --lib
```

Expected: PASS. This confirms the default planner surface exposes `get_task` and does not expose repo map or direction proposal tools by default.

- [ ] **Step 4: Run repo-less storage/session test**

Run:

```bash
cd src-tauri && cargo test repo_less_direction_can_back_a_generic_session
```

Expected: PASS. This confirms `repo_id = 0` can back a generic run session.

- [ ] **Step 5: Run lead prompt test**

Run:

```bash
cd src-tauri && cargo test --test lead_prompt
```

Expected: PASS. This confirms the coordinator prompt is Atlas-branded and generic.

Do not commit in this task. If any command fails, stop execution, capture the exact failing command and output, and diagnose that failure before continuing to Task 6.

## Task 6: Final Local Gate And Fresh Runtime Check

**Files:**
- Verify: entire branch

- [ ] **Step 1: Run whitespace check against `main`**

Run:

```bash
git diff --check main...HEAD
```

Expected: PASS with no output.

- [ ] **Step 2: Run quick preflight**

Run:

```bash
pnpm preflight:quick
```

Expected: PASS. This should run whitespace check, Atlas identity check, agent-base default verifier, frontend build, and Rust test compilation.

- [ ] **Step 3: Run a fresh data-dir desktop smoke test**

Run:

```bash
ATLAS_HOME="$(mktemp -d /tmp/atlas-agent-base.XXXXXX)" \
ATLAS_TEST_DB_KEY_B64="$(openssl rand -base64 48)" \
pnpm tauri dev -- --bin atlas-app
```

Expected terminal markers:

```text
VITE
Running `target/debug/atlas-app`
[atlas] thread bus on http://127.0.0.1:
```

If the app starts, use the visible desktop window to verify:

1. The sidebar shows Atlas, task creation, Needs you, Board, and Settings.
2. The sidebar does not show Add repo or Repo map.
3. Creating a workspace and task does not ask for a repository.
4. Starting the default run opens a chat/session surface.
5. No Diff button appears for the repo-less run.

Stop the dev server with `Ctrl-C` after verification.

- [ ] **Step 4: Record final status**

Run:

```bash
git status --short --branch --untracked-files=no
```

Expected: clean tracked state on `codex/merge-agent-base-into-atlas`.

If untracked `native/AtlasNative/.build` files are still present, leave them untouched and mention them in the final handoff.

## Task 7: PR Preparation Notes

**Files:**
- Verify: final commit history

- [ ] **Step 1: Review commits**

Run:

```bash
git log --oneline main..HEAD
```

Expected: commits should include:

```text
docs: design Atlas-safe agent base merge
fix(ui): restore Atlas task run default path
chore: guard Atlas agent base defaults
```

If backend fixes were needed, the log may also include:

```text
fix(agent): keep Atlas run path generic
```

- [ ] **Step 2: Prepare PR body**

Use this body:

```markdown
## Summary
- Restores the generic workspace -> task -> run default path on top of current Atlas main.
- Removes repo-first sidebar/default-route entry points from the normal task flow.
- Adds a default-path verifier so old identity markers and repo-first defaults cannot return silently.

## Root Cause / Why
The earlier generic Agent App work was authored before the Atlas product identity migration. A mechanical merge would risk reintroducing old identity strings and repo-first defaults, so this PR semantic-ports only the useful task/run behavior onto Atlas.

## Validation
- `scripts/verify-atlas-identity.sh`
- `node scripts/verify-agent-base-defaults.mjs`
- `pnpm build`
- `pnpm preflight:quick`
- `cd src-tauri && cargo test paths::tests::run_home --lib`
- `cd src-tauri && cargo test brief::tests::generic_run_brief_has_no_repo_or_check_contract --lib`
- `cd src-tauri && cargo test bus::server::planner_tests::planner_specs_expose_generic_task_tools_only --lib`
- `cd src-tauri && cargo test repo_less_direction_can_back_a_generic_session`
- `cd src-tauri && cargo test --test lead_prompt`

## Notes
This is not a mechanical merge of the old agent-base branch. It is an Atlas-safe semantic port that keeps Atlas runtime identity, assets, protocol names, and data paths intact.
```

- [ ] **Step 3: Do not push until the user asks**

Expected: stop after local validation unless the user explicitly asks to push/open a PR.
