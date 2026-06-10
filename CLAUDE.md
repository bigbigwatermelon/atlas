# Claude Code 启动包 — Weft(coding-agent 驱动的多仓需求交付中心)

配套架构文档:`多仓多工具会话编排器-架构设计与可行性.md`(完整设计与可行性)。本启动包是它的"开工版",只保留落地必需信息,并已同步最新决策(lead/worker、主 agent 为家、surface 解耦、两级看板、i18n、产品化屏蔽)。

工作名 **Weft**(字标可换);定位:**本地优先、无服务端、coding-agent 驱动的多仓需求交付中心**。

---

## 0. 可直接粘贴给 Claude Code 的 kickoff prompt

> 在一个空仓库里启动 Claude Code,把架构文档放成 `ARCHITECTURE.md`、本启动包的约束放成 `CLAUDE.md`,然后贴下面这段。

```
你将从零实现 Weft:一个本地优先、无服务端的桌面应用——coding-agent 驱动的多仓需求交付中心。
完整设计见 ARCHITECTURE.md,这份 CLAUDE.md 是开工约束。

技术栈(已锁定,不要更换):
- Tauri v2(Rust 后端 + 前端 React + TypeScript + Vite)
- 会话驱动:headless chat 引擎(claude 长驻 stream-json;codex `exec --json` / opencode `run --format json` 每回合一进程),weft 自有会话 UI
- 本地状态:SQLite(tauri-plugin-sql 或 sqlx)
- git:直接调用系统 git 的 worktree 子命令
- i18n:react-i18next(或 FormatJS),中/英从第一天内建

不可违背的理念:
1. 原生驱动各 CLI(claude / codex / opencode),不走 ACP,保全 hooks/skills 等原生能力。
2. headless 驱动 + 产品自有会话 UI:吃各工具官方的结构化流(stream-json / exec --json / run json)渲染 weft 自己的会话时间线,不内嵌终端;原生 TUI 体验留给逃生舱(停引擎 + 复制 resume 命令在用户终端接管),工具有更好的 app 就深链跳过去。
3. 跨仓接线只用临时启动参数,绝不写进 canonical 仓的受控配置。
4. 物化用 git worktree;分支命名空间含 thread 维度。
5. 产品化:屏蔽机制(worktree/headless 进程/MCP/add-dir),呈现决策与结果(scope/分支/PR/diff/工具)。机制退到 Inspect。
6. 层级:Workspace ⊃ Thread(工作线/需求)⊃ Direction(方向)⊃ Session(工具×worktree)。
   会话有 role=curator|lead|worker:curator=workspace 维护仓库地图,lead=主 agent(只读纵览+规划+驱动 worker),worker=方向执行体。
7. Automation-first:lead 默认自动分解→spawn→派发→驱动到交付,不自加审批关;唯一阻塞来自工具自身权限(透传)。质量靠"可执行验证 + 确定性升级判据 + 跑飞护栏",不是人点头。
8. 入口抽象 = Task(任意粒度意图:PRD/bug/重构/spike/链接,PRD 只是一种);交付是**分阶段**的——当前止于 Task→PR,北极星是 Task→上线(开 PR → 合并 → 跨环境部署 staging→production)。合并/部署**不重造 CI/CD**,而是**编排仓库现有流水线**,并受可配置的不可逆边界(合并受保护分支、生产部署)把关。规划下沉给 plan skill(superpowers 等),编排借 Dynamic Workflows 原理但不重实现。

第一步只做 M1 垂直切片(见下"构建顺序"):单工具在一个 git worktree 里创建可交互会话,
能发消息、能打断、关闭后能 resume 回同一会话。跑通并过验收后再往后做。

每个 milestone:补测试、自测通过、给我改动说明。先规划再动手。所有面向用户的字符串走 i18n,不要硬编码。
```

---

## 1. 锁定的技术决策(不要重新讨论)

- 外壳 Tauri v2;前端 React+TS+Vite;状态 SQLite;i18n react-i18next。
- 工具驱动:**headless chat 引擎**(claude 每 timeline 一个长驻 stream-json 进程,双向;codex `exec --json`、opencode `run --format json` 每回合一进程)+ **sidecar 旁路读各工具会话存档(结构化,只读,observe 用)**。
- 物化:**git worktree**,分支 `ws/<workspace>/<thread>/<direction>`。
- 三家(Claude Code / Codex / OpenCode)**同为第一批**,统一 `ToolDriver` 抽象。
- 会话 **role = curator | lead | worker**;主 agent(lead)默认绑 **Claude Code**,thread 可覆盖;curator 默认绑快/省模型。
- **Automation-first**:lead 默认自动分解→spawn→派发→驱动到交付,**Weft 不自加审批关**。唯一阻塞来自工具自身权限(透传)+ 可配置的不可逆边界(合并受保护分支、生产部署等)。人随时可介入,非必经 gate。
- surface 与 observation 解耦;**中/英 i18n 两层**(UI 文案 + agent 产出语言)。
- 本地优先、无服务端、无身份;团队共享走配置下发(git/marketplace),低优先级。
- **入口 = Task**(PRD/bug/重构/spike,PRD 只是一种);**交付分阶段:当前 Task→PR,北极星 Task→上线**(开 PR → 合并 → 跨环境部署 staging→production);合并/部署通过**编排仓库现有流水线**达成,不重造 CI/CD,受不可逆边界把关。
- **质量闭环**:Weft 内只做轻量 pre-PR 检查(lint/type/unit/contract);权威 review/CI = 仓库现有 PR harness,不重造。合并后的部署同样**编排现有 CD 流水线**(预发→生产),Weft 驱动 + 观测,不重写发布系统。
- 规划下沉给 plan skill(superpowers 等);编排借 Dynamic Workflows 原理(编排即代码+结构化 handoff),不重实现;Claude worker 叶子层可自用 DW。

---

## 2. MVP 范围

**In**
- 数据模型 + SQLite:Workspace / Thread(type, leadAgent)/ Direction(write/read repos, tool, workerMandate)/ Session(role, surface, nativeSessionId)。
- worktree 编排:创建/列出/删除,分支命名空间化,按仓 diff。
- 三家方言收敛进 chat 引擎:spawn + resume + 回合排队/打断 + sidecar 事件归一化 + 逃生舱(终端接管命令 / 深链)。
- **curator/lead/worker**:curator 维护仓库地图(Repo Profile + 依赖图);lead 只读纵览 → 出 scope + 方向 brief → **自动拉起 worker(automation-first)**;worker 按 mandate 执行。
- **质量闭环**:acceptance 可执行化 → worker 完成=检查绿(非自报)→ 验证阶梯(lint/type/unit/contract/review-agent)→ 有界自动重试 → 确定性升级判据 → 跑飞护栏(预算/loop detection/爆炸半径)。
- **主 agent 为家**的主界面 + 会话交互(4.3:chat 时间线/composer/打断/Ask Bridge 审批/注入排队)。
- scope 确认步(全仓 write/read/none → 懒物化)。
- **agent-first 看板,两级**:Workspace 板(cards=thread + 仓争用)+ Thread 板(cards=direction);Needs-you 重心;卡自动流转、人只做动作。
- thread bus(本地 MCP)+ coordinator 注入队列(基础版)。
- 配置物化(team skills/rules + PLAN.md 注入)。
- **i18n 中/英**(UI 文案 + agent 产出语言偏好)。
- 产品化屏蔽(机制进 Inspect,产品词在台前)。

**Out(MVP 不做)**
- 复杂的全自动跨工具编排引擎做基础版即可(automation-first,但 DAG/重试/契约传播先做够用;不必一步到位)。
- 团队实时协作 / 团队看板 / 服务端 / 遥测。
- **合并 → 跨环境部署(staging→production)/ release 的全自动驱动**——属北极星路线图,但**不在 MVP**;MVP 仍止于 Task→PR。权威 review/CI 用仓库现有 harness;落地时 Weft **编排**现有 CD 流水线驱动 + 观测,绝不自建发布系统。
- 远程项目;合并冲突自动解;RTL。

---

## 3. 仓库脚手架(建议)

```
/src-tauri            Rust 后端
  git.rs              worktree 管理、diff
  /lead_chat          headless chat 引擎(engine/proto/commands):claude 长驻 stream-json,codex/opencode 每回合一进程
  ask.rs              Ask Bridge:三家权限请求 → Needs-you 卡 → 决定回流
  sidecar.rs          读各工具会话存档 → NormEvent(observe,只读)
  planner.rs / curator.rs / coordinator.rs / brief.rs   lead 编排(survey/scope/brief/dispatch)
  /bus                thread bus 的本地 MCP server + coordinator 注入
  materialize.rs      scope → worktree + add-dir 参数 + 资产注入
  /store              SQLite schema + 仓储
/src                  React 前端
  /session            chat 时间线 + composer + observe/diff 视图(4.3 交互层)
  /board              agent-first 看板(workspace 级 + thread 级)+ scope 确认步
  /nav /components    workspace 导航、对话框、UI 基础件、Inspect 逃生舱(worktree 路径/开终端)
  /i18n               en / zh 资源 + 运行时切换
ARCHITECTURE.md / CLAUDE.md
```

---

## 4. 核心抽象:chat 引擎(三家差异收敛于此,src-tauri/src/lead_chat/)

没有 ToolDriver trait——引擎自建命令,三家差异收敛为两种方言分支:

```
长驻方言(claude):每 timeline 一个 headless 进程,stdin 收 JSON user 消息
  claude -p --input-format stream-json --output-format stream-json \
    --include-partial-messages --verbose [--append-system-prompt …] [--resume <id>]
每回合方言(codex / opencode):一回合一进程,消息走 argv,EOF 即回合结束
  codex exec [--add-dir …] --json --cd <cwd> [resume <id>] <msg>
  opencode run --format json [--session <id>] <msg>
```

引擎不变式:
- **消息归 weft 所有**:stdout 经 proto 解析 → `lead_message` 落 SQLite → `lead-chat` Tauri 事件增量推前端(message/delta/finalize/turn/init/activity)。
- **回合排队(TurnState)**:回合进行中收到的输入(人类或 coordinator 注入)整条入队,回合结束按序送出——不丢、不混插。
- **打断**:claude 走协议 `control_request`(3s 未停 kill 兜底);per-turn 方言直接结束当前回合进程。无论哪种,native id 在手,下次发送 `--resume` 无损续上。
- **附件**:claude 收 inline base64 图片;codex/opencode 不收 → 落临时文件传路径。

各家命令映射:
- **Claude**:长驻 stream-json(+ `--add-dir <read_dirs>`,resume `--resume <id>`);sidecar=读 `~/.claude/projects/<编码cwd>/*.jsonl`。lead 首选(多目录 + subagents 强)。
- **Codex**:`codex exec --json`(+ `--add-dir`,resume `codex exec resume <id>`);sidecar=读 `~/.codex/sessions/<date>/` rollout jsonl;**别用 CODEX_HOME 隔离(resume bug #5247)**。
- **OpenCode**:`opencode run --format json`(resume `--session <id>`);sidecar=只读其本地 SQLite(`~/.local/share/opencode/opencode.db`)。多根弱 → 当 worker,不当 lead。

逃生舱(替代旧 open_surfaces):三家皆可**在终端接管**(`chat_stop` 停引擎 + 复制 resume 命令到用户终端);Codex 另有 app 深链 `codex://threads/<id>`(best-effort,archived 会失败,需兜底);Claude 无会话级 app-link。

事件归一化:`NormEvent { Started{id}, Message, ToolCall, FileChanged{repo,path,+,-}, ApprovalRequested{cmd}, BusMessage, Idle, Exited }`。

lead/worker 协作:lead 用 planner MCP(`survey_repos`/`declare_scope`/`propose_directions`)产出结构化 scope+brief;worker 经 thread bus 回报**结构化摘要 + diff stat**(lead 绝不吞 worker 原始 transcript)。

审批(4.3 Ask Bridge):三家各在自己的结构化拦截点(Claude PreToolUse hook、Codex approval-request、OpenCode /event)汇到一个 weft 端点 → Needs-you 卡,人答 Allow/Always/Full/Deny,决定回流给被阻塞工具——不刮终端输出。

注入仲裁(4.3):程序注入(thread bus / coordinator)与人类消息同走引擎回合队列;busy 时整条排队,回合结束按序送出。

---

## 5. 构建顺序(每步带验收标准)

### M1 — 垂直切片:单工具端到端
worktree(`ws/demo/t1/main`)→ chat 引擎 spawn claude 会话 → weft 会话时间线渲染。
- **验收**:会话里发消息改文件;能打断;关闭后 `--resume` 在同一 cwd 接回历史继续;worktree 内见改动。

### M2 — worktree 编排 + 数据模型
Workspace/Thread/Direction/Session 落 SQLite;worktree 建/列/删 + 按仓 diff。
- **验收**:一个 thread 下 2 个 direction(不同仓不同分支)互不干扰;删 thread 清理全部 worktree;同仓被两个 thread 各开 worktree 不冲突。

### M3 — 三家方言 + 旁路归一化 + 逃生舱
补 codex/opencode 的 per-turn 方言;sidecar → NormEvent;实现终端接管命令 + Codex 深链。
- **验收**:同一 thread 并排跑三家会话,各自可交互;右栏从 NormEvent 聚合按仓 diff/状态;权限请求经 Ask Bridge 触发审批态;Codex 卡能 `codex://threads/<id>` 跳 app 且 Weft 经 sidecar 仍同步(跳走前引擎停写,同一原生会话单 writer)。

### M4 — 会话交互层(4.3)
chat 时间线(流式 delta + Activity 行)、composer(多行/图片/`@` 文件/slash 命令面板)、打断、Ask Bridge 审批条、注入排队提示。
- **验收**:审批点 Allow 等于在原生工具里放行(决定回流);slash 命令面板列出该 CLI 的命令(initialize 握手);长多行 prompt 经 composer 一次送达不乱码;busy 中发送进队列、回合结束自动送出且顺序不乱。

### M5 — lead/worker + scope 懒物化 + 主 agent 为家 UI
lead 只读纵览 → scope 确认步 → 仅 write 仓建 worktree、read 只读挂载、none 不挂;lead 出 brief →(人确认)→ 拉起 worker(mandate:plan+impl / impl-only);主界面以 lead 对话为家,worker 在执行车间,impl-only 默认折叠成 diff。
- **验收**:plan 标 none 的仓零 worktree;主对话里能审 scope/方向并一键拉起 worker;impl-only worker 折叠为 diff/状态、可展开;**automation-first(默认自动 spawn/驱动,不插 Weft 审批;只透传工具自身权限请求)**。

### M6 — agent-first 看板(两级)+ 配置下发 + i18n
Workspace 板(cards=thread + 仓争用 + Needs-you 聚合)+ Thread 板(cards=direction);卡随 session/git 状态自动流转,人只做动作;跨 thread 重叠告警;thread bus + coordinator 唤醒;按仓 PR/合并/清理;配置下发(Claude `/plugin marketplace`、Codex `codex marketplace`、OpenCode `opencode-remote-config`/npm);中/英 i18n 全量。
- **验收**:两级看板缩放联动;Needs-you 在 workspace 级聚合所有 thread 阻塞;两个 thread 改同仓时仓争用条与卡片给出重叠告警;切到 EN 后 UI 全量翻译、agent 新产出按所选语言;有效配置预览标出 skill/rule 来自团队/个人/仓哪层。

---

## 6. 验证要求(每个 milestone)

- 单元:git/worktree、scope→物化映射、事件归一化、回合排队状态机(TurnState)、resume 命令/深链构造。
- 集成:各 CLI 真实二进制跑 spawn/resume 冒烟;Codex 深链跳转冒烟。
- i18n:中/英全量切换无漏译;状态枚举内部保持英文、仅 UI 映射;agent 产出语言随偏好。
- 手动验收:逐条过每个 milestone 的"验收"。
- 关键回归:Claude resume 的 cwd 一致;不要 CODEX_HOME 隔离;接线不落 canonical 仓;lead 上下文不吞 worker 原文。

---

## 7. 已知坑(提前规避)

- Claude `--resume` 依赖 cwd 编码一致 → worktree 路径必须稳定。
- Codex `CODEX_HOME` + `codex resume` 有 bug(#5247)→ 回流的会话用标准 home + `--add-dir`。
- Codex 深链契约未完全稳定、archived thread 静默失败 → 当 best-effort,失败要兜底提示。
- per-turn 方言(codex/opencode)无常驻进程:打断 = 结束当前回合进程;inline 图片不支持 → 落临时文件传路径;别按长驻方言的假设写代码。
- 同一分支不能在两个 worktree 同时检出 → 分支必须含 thread 维度。
- 每 worktree 一份依赖 → 懒装/链接共享,控制磁盘。
- **lead 上下文爆炸**:跨仓 scope 分解靠 survey 工具(file-tree/grep/定向读)+ 轻量索引,别 ingest 全部——这是"跨仓 scope 自动分解"这个核心 wow 的成败点,早做原型。
- **brief 质量 = 产品天花板**:总 plan → 方向 brief 的翻译当一等产物打磨,颗粒度匹配 mandate。
- i18n 别只做 UI:agent 产出语言是第二层;代码/标识符始终英文。
- 隐藏机制必须配"失败可读 + 就地逃生舱",否则抽象一漏用户就卡死。
- 别重造 PR review/CI/CD:worker 开 PR 时仓库现有 hooks/CI 自然触发(Weft 驱动原生 CLI 不绕 hooks),Weft 只做轻量 pre-PR 检查 + 观测 PR/CI 状态。**北极星的合并 + 跨环境部署同理——编排仓库现有 CD 流水线(预发→生产),绝不自建发布系统。**
- automation-first 但要有"跑飞护栏":每 thread/direction 预算上限 + 相同失败 loop detection + 不可逆边界可配置,否则全自动会烧钱/失控。
