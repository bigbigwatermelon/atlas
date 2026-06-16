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
