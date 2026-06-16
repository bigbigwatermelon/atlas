#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
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

function forbidFile(path, message) {
  if (existsSync(path)) {
    fail(`${path}: ${message}`);
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
  "src/nav/WorkspaceNav.tsx",
  /WorkspacePicker|CreateWorkspaceDialog|setDlg\("ws"\)|nav\.newWorkspace|nav\.renameWorkspace|dialog\.workspaceName/,
  "default sidebar must not expose task environment switching or creation",
);
forbidRegex(
  "src/nav/dialogs.tsx",
  /function\s+CreateWorkspaceDialog|export\s+function\s+CreateWorkspaceDialog/,
  "task environment creation dialog must not remain as a UI module",
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

[
  "src/board/RepoGraph.tsx",
  "src/board/RepoMapView.tsx",
  "src/board/ScopeReview.tsx",
  "src/session/DiffPanel.tsx",
  "src/session/DiffView.tsx",
  "src/session/useRepoActions.ts",
  "src/components/EffectiveConfigDialog.tsx",
  "src-tauri/src/lead_chat/repo_state.rs",
  "src-tauri/tests/lead_repo_state.rs",
  "src-tauri/src/check.rs",
  "src-tauri/src/curator.rs",
  "src-tauri/src/gc.rs",
  "src-tauri/src/materialize.rs",
  "src-tauri/src/planner.rs",
  "src-tauri/src/profile.rs",
  "src-tauri/src/store/entities/repo_ref.rs",
  "src-tauri/src/store/entities/repo_profile.rs",
  "src-tauri/src/store/entities/worktree.rs",
  "src-tauri/src/store/entities/plan.rs",
  "src-tauri/tests/m2_git.rs",
  "src-tauri/tests/m2_worktree.rs",
].forEach((path) => forbidFile(path, "legacy repo/worktree/scope module must not exist"));

forbidRegex(
  "src/state/store.tsx",
  /worktreesByDirection|repoProfiles|repoEdges|openRepoMap|refreshRepoMap|reprofileRepo|editRepoProfile|writeTriggers|approveWriteTrigger|denyWriteTrigger|createDirection|verifyDirection|requestSkillReview|sendToDirection|reviewSkill|autoReview|setHomeTab\("repos"\)|HomeTab\s*=\s*"board"\s*\|\s*"repos"/,
  "store must not expose repo/worktree/diff/review/scope controls",
);

forbidRegex(
  "src/lib/api.ts",
  /invoke<[^>]+>\("(list_repos|add_repo_ref|clone_repo|create_repo|repo_graph|reprofile_repo|update_repo_profile|get_proposal|save_proposal|confirm_proposal|create_direction|list_worktrees|worktree_diff|repo_diff|verify_direction|write_triggers|approve_write_trigger|deny_write_trigger|effective_config|post_lead_tool_result|chat_open_worker|workspace_needs_counts)"/,
  "frontend API must not expose legacy repo/worktree/diff/review/scope commands",
);

forbidRegex(
  "src-tauri/src/lib.rs",
  /mod\s+(check|curator|gc|planner|profile)\s*;|pub\s+mod\s+materialize\s*;|commands::(add_repo_ref|clone_repo|create_repo|list_repos|list_repo_profiles|repo_graph|reprofile_repo|update_repo_profile|worktree_diff|get_proposal|save_proposal|confirm_proposal|preview_brief|verify_direction|create_direction|list_worktrees|repo_diff|workspace_needs_counts|effective_config|write_triggers|approve_write_trigger|deny_write_trigger)|lead_chat::commands::(post_lead_tool_result|chat_open_worker)/,
  "Tauri invoke handler must not register legacy repo/worktree/diff/review/scope commands",
);
forbidRegex(
  "src-tauri/src/store/entities/mod.rs",
  /repo_ref|repo_profile|worktree|pub mod plan/,
  "store entity registry must not include legacy repo/worktree/proposal tables",
);
forbidRegex(
  "src-tauri/src/store/repo.rs",
  /add_repo_ref|list_repos|get_repo_profile|upsert_repo_profile|get_plan|upsert_plan|direction_repo_of|record_worktree|list_worktrees|worktree_for|repo_id:\s*i32|Column::RepoId/,
  "store helper layer must not expose legacy repo/worktree/proposal scope helpers",
);
forbidRegex(
  "src-tauri/src/store/migration/mod.rs",
  /create_table\(Self::table\(&schema,\s*(plan|repo_ref|repo_profile|worktree)::Entity\)\)|ColumnDef::new\(Alias::new\("repo_id"\)\)|ColumnDef::new\(Alias::new\("reason"\)\)/,
  "fresh migrations must not create legacy proposal/repo/worktree tables or scope columns",
);
forbidRegex(
  "src-tauri/src/bus/server.rs",
  /"review"|review \(done coding|awaiting the human/,
  "agent status tools must not expose review state",
);
forbidRegex(
  "src-tauri/src/bus/global.rs",
  /list_issues|issue_status|create_issue|ensure_issue_topic|\bissues\b|\bissue\b/,
  "global MCP tools must use generic task naming, not issue naming",
);
forbidRegex(
  "src-tauri/src/lead_chat/commands.rs",
  /list_issues|issue_status|create_issue|ensure_issue_topic|\bper-issue\b/,
  "Concierge prompt must use generic task tool names",
);
forbidRegex(
  "src/session/ChatTimeline.tsx",
  /m\.kind === "proposal"|proposalReady|proposalArchived/,
  "chat timeline must not render legacy proposal cards",
);
forbidRegex(
  "src/lib/types.ts",
  /"proposal"/,
  "frontend lead message type must not expose legacy proposal cards",
);

forbidRegex(
  "src-tauri/src/lead_chat/sentinels.rs",
  /ListRepos|LIST_REPOS|atlas:list_repos/,
  "lead sentinels must not support repo listing",
);
forbidRegex(
  "src-tauri/src/lead_chat/engine.rs",
  /Sentinel::ListRepos|list_repos_result|atlas:list_repos|lead sentinel: list_repos/,
  "lead engine must not answer repo-list sentinels",
);
forbidRegex(
  "src-tauri/src/lead_chat/commands.rs",
  /repo_state|post_lead_tool_result|repo_action|chat_open_worker\(/,
  "lead command surface must not inject repo state or expose repo action callbacks",
);
forbidRegex(
  "src-tauri/src/brief.rs",
  /curator|RepoBrief|BriefData|format_brief|direction_repo_of|write repos|worktree|diff|set_task_status\("review"\)|repo map|cross-repo|git repository/,
  "run brief must stay generic and must not restore repo/worktree/diff/review contracts",
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
forbidRegex("src/i18n/en.ts", /Repo map|Add a repo|worktree|review-ready tasks|Global review skill|Auto review|working copy/, "English copy still exposes repo/worktree/review defaults");

forbidPhrase("src/i18n/zh.ts", "添加仓库 · Curator 自动盘点", "中文 onboarding 仍以仓库开始");
forbidPhrase("src/i18n/zh.ts", "依赖图自动成形", "中文 onboarding 仍先讲依赖图");
forbidPhrase("src/i18n/zh.ts", "Lead 跨仓拆解 scope", "中文 onboarding 仍先讲跨仓 scope");
forbidPhrase("src/i18n/zh.ts", "把一个 Task 拆成可交付的多仓工作", "中文 onboarding 仍把多仓交付作为产品默认");
forbidPhrase("src/i18n/zh.ts", "从仓库地图到 scope", "中文 preview 仍以仓库地图为中心");
forbidPhrase("src/i18n/zh.ts", "规划这个 issue", "中文任务空态仍说 issue");
forbidPhrase("src/i18n/zh.ts", "读取你的仓库", "中文任务空态仍假设仓库");
forbidPhrase("src/i18n/zh.ts", "个子任务 · 并行执行", "中文 thread copy 仍说子任务");
forbidPhrase("src/i18n/zh.ts", "运行该子任务的检查", "中文 review copy 仍说子任务检查");
forbidPhrase("src/i18n/zh.ts", "任务台", "中文文案仍暴露任务台概念");
forbidRegex("src/i18n/zh.ts", /仓库地图|添加仓库|worktree|进入 review|全局 review skill|自动 review|工作副本/, "中文文案仍暴露仓库/worktree/review 默认概念");
forbidRegex("src/i18n/en.ts", /[Tt]ask hub/, "English copy still exposes task hub concept");

if (failures.length > 0) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}

console.log("Agent base default-path checks passed.");
