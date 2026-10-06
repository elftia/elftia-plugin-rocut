# Rocut 性能测试 Session 交接

更新日期：2026-10-06。接手范围是实际安装在 Elftia 中的 Rocut 性能验收、测量工具及证据闭包。原 session 继续功能开发，不再运行这部分性能测试。当前插件主要功能已有真机证据，但性能总体验收仍未完成；下面的诊断通过不能替代最终验收。

## 分工与并发约束

| 范围 | 负责人及规则 |
| --- | --- |
| 720p 持续播放、seek、局部编辑、F05 内存与 GPU 释放、测量可信度 | 接手的性能 session |
| 本文列出的性能探针、性能报告和最终性能 sidecar | 接手的性能 session |
| Rocut 功能缺口、交互与 UI 修复、功能单测、功能验收 | 原开发 session |
| 渲染器、WASM、缓存、项目事务等产品代码 | 原开发 session 默认负责；性能 session 发现根因后交付复现和建议，修改前协调文件范围 |
| 当前 CDP 9361 实例和专用测试会话 | 交接后留给性能 session；两边不得同时导航、播放、改变视口或替换插件 |

两个 session 共享工作树，不要同时修改同一文件，不要回滚对方改动。性能测量期间原开发 session 不跑重构建、压力测试或更换被测插件。需要新候选产物时，先冻结源码与安装摘要，再交接安装时段。不能因为仓库 HEAD 变化就把旧证据归到新版本。

本交接没有启动子 agent。交接时所有本轮测试进程均已结束；没有待轮询的测试任务。20 秒探针的窗口、播放位置、原项目及画布设置均已恢复。

## 已有授权与不可越过的边界

- 不走 Rasen，不生成索引，不启动子 agent。
- 可以提交和推送 Rocut、插件 producer 的任务相关改动；不得提交或推送 Elftia 主仓库。
- Elftia 生命周期操作、验证过独立备份后的 Rocut 插件替换已有授权，但仍须先核实实例归属、安装目标和并发占用。不要终止其他程序；Steam 保持启用。
- 只操作专用 E2E 项目，不操作用户现有剪辑。禁止付费调用或上传用户素材。
- 本地 ASR 的模型下载仅获准用于该项本地验收，而且真实 ASR 已通过；性能测试无需再次下载模型。
- 先前 `.tmp-probe` 清理被执行层拒绝，尚未删除。不得换工具或技巧绕过拒绝。
- 保持所有原定阈值和画面对照标准。失败原件保留，禁止无变化地重试到绿，禁止把诊断输出改写为验收通过。
- 原始 Chromium trace、CPU profile 可能含认证 URL，只留在本地；不得输出、提交或打包。错误也需脱敏。本文是操作交接，不是可直接纳入 canonical manifest 的脱敏证据。
- Windows PowerShell 为 5.1。文本严格按 UTF-8 读取，使用 `apply_patch` 编辑。不要使用未加引号的 `@{upstream}`、PowerShell 7 专属语法或原生程序双引号嵌套；复杂 Node 脚本优先文件入口。

## 仓库和运行环境

| 名称 | 路径或交接时值 |
| --- | --- |
| Elftia 主仓库 | `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia` |
| Rocut 源仓库 | `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut` |
| Rocut 插件 producer | `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-rocut` |
| 安装位置 | 当前用户目录下 `.elftia/plugins/rocut` |
| E2E 根目录 | Elftia 主仓库下 `.tmp-rocut-e2e` |
| 专用项目工作目录 | `.tmp-rocut-e2e/project` |
| 专用会话 ID | `5b7fd2fa-b386-4f15-ab52-98514193ddd8` |
| CDP | `9361` |
| Electron 主进程 | 交接时 PID `19848`，可执行文件是主仓库的 `node_modules/electron/dist/electron.exe`；接手时重新核实 |
| 浏览器 | Chrome `144.0.7559.96`，Electron `40.1.0` |
| 实际预览后端 | 已从现有画布确认 WebGPU；`getConfiguration().device.queue.onSubmittedWorkDone` 可用 |

进入项目先读主仓库 `CLAUDE.md`、`.claude/skills/elftia-cli-testing/SKILL.md`、`.claude/skills/code-standards/SKILL.md`，修改 Rocut 前读其 `AGENTS.md`。不需要重读整个项目或重新执行已通过的功能矩阵。

保护主仓库原有修改，尤其 `packages/server/src/host/BusServer.ts` 和两个未跟踪的 director JSON。Rocut 的 `.rasen/`、`.tmp-digest-check.ts`、`.tmp-probe/`、`rasen/changes/r08-host-ensure-and-runtime/` 也不是本交接可清理的内容。zvec 服务曾返回 `Transport closed`；可使用有范围的 `rg`，不要创建新索引。

## 被测安装版本

- 插件版本保持 **0.5.0**。此前提到的 0.6.4 属于 Omnicross，不是本插件。
- 安装的运行时源码 pin：`1b2d820822cf47d74ae2bdd5d6ba29d6d7eaa42b`。Rocut 后续 `2ee4d5c9` 是文档提交，不是另一套已安装运行时。
- app：`app-8Ye6Xf_g.js`，SHA-256 `93e84f3924d835a60baf98fbf8d90cf12fa7fdc276c0b10ff914d297ccec7041`。
- 安装树独立清单摘要：`047ccec3d3667db43d23687cfa314f25126f6bd44184fb2d73b4bf64a8d2c57f`。
- 当前 epkg：producer 的 `release/local-1b2d8208/rocut.epkg`，86,160,162 字节，356 个文件，SHA-256 `0ea48a4e816333fb848e5dea2d72da7952639c33d4f8e7f9773df01c4b7134b6`。
- 当前独立备份：E2E 根下 `archived-plugin-backups/rocut-0.5.0-before-caption-cancel-vQF6Q6/rocut`。
- `dddc9ed` 已提交隔离的 Chromium trace 工具。本交接所在的后续提交增加 WebGPU 完成观察器、720p 可逆设置及本文；没有修改运行时或重新打包。

接手时通过 Git 和安装文件重新核实这些值，保留基线，不盲目 pull 后立即开始计时。

## 必须保留的验收门槛

主仓库 `docs/design/rocut-jizura-integration-development-plan.md` 第 13.3 节为准；Rocut 的 `docs/motion-text/s09-installed-acceptance-contract.md` 定义最终证据。

| 项目 | 门槛及要求 |
| --- | --- |
| 常规预览 | 真实 720p、30 fps、单动效叠加视频，热身后帧耗时 p95 不超过 33.3ms；固定 F01/F04，记录 CPU、GPU、字体环境 |
| seek | F04 至少 30 个乱序目标，真实目标画面可见 p95 不超过 250ms，不能只看 DOM 时间码 |
| 局部编辑 | F04 至少 30 次单 cue 修改到稳定画面，p95 不超过 300ms |
| 内存 | 有界缓存；F05 为 600 cue、8 分钟，seek 不随访问帧数持续线性增长；观察关闭释放 |
| 取消 | 可协作执行阶段不超过 1 秒；原生编码调用单独记录 |
| 导出 | 1080p 全范围和非零起点选区；准确帧数、唯一音轨、音画误差不超过一帧 |

区分三种计时：预览提交返回、WebGPU 队列完成回调、浏览器合成或实际呈现。它们不是同一指标。GPU 回调包括排队和回调派发，不是 GPU shader 执行时长，也不是屏幕呈现时间。合成器报告包含编辑器控件，不能当作视频 FPS。最终报告要明确测量边界并提供对应画面证据，不得只给一个名为 previewP95Ms 的数字。

## 已有证据和不能重复宣称的结论

以下目录均相对 E2E 根，读取其 `evidence.json` 及关联文件。测试成功只覆盖该行的范围。

| 目录 | 结果与边界 |
| --- | --- |
| `live-i3GR21` | 当前运行时 F04 局部编辑 7/7；30 次精确画面对照，p95 250.20ms，最大 265.39ms |
| `live-SQsw0H` | 当前运行时 F04 seek 7/7；30 次乱序精确画面对照，p95 203.50ms，最大 213.10ms；含截图传输解码开销 |
| `live-jVQHOT` | 当前运行时连续功能 35/35，零 page error；不是本轮历史替换 40 项全量验收 |
| `installed-gpu-memory-uPeVuT` | 600 个独立参考图、2,400 次精确匹配；4 个完整周期、iframe 销毁重开、项目恢复；诊断成功，非最终内存通过 |
| `installed-gpu-memory-KzaQyy` | 保留失败：screencast 流冻结；独立截图恰好匹配 cue 526。不能重写失败或认为产品必然黑屏 |
| `presentation-trace-KyubVL` | 最初广域 trace：127,551,794 字节、676,378 个事件，开销较大，不用于通过判断 |
| `presentation-trace-15JsPg` | 精简 trace：12,293,191 字节、52,724 个事件；编辑器 PID 与宿主 PID 已隔离。1080p、约 20 秒，非视频专属呈现证据 |
| `presentation-trace-4qnyDm` | 1080p GPU 完成短测；543 次提交均有回调，394 个热身后样本。提交 p95 6.6ms，预览开始到 GPU 回调 p95 29.7ms，最大 97.8ms |
| `presentation-trace-dxGauK` | 真实 1280×720 GPU 完成短测；543 次提交均有回调，394 个热身后样本。提交 p95 5.1ms，预览开始到 GPU 回调 p95 22.2ms，最大 98.1ms。零溢出、失败、待完成任务；原画布设置与项目已恢复 |

最后两个短测都是 20 秒，前 5 秒按时间线热身排除；不覆盖完整 180 秒播放，不验证音频持续输出或实际视频呈现，也没有完成观察器开销对照。两份原始证据生成时尚未内嵌 `gpu.summary`；可用 `summarizeWebGpuObservation(evidence.gpu)` 只读计算，它已对这两份原始证据通过。不要回写历史原件。

内存观察的 post-GC JS heap 为 23,178,280 → 23,861,512 字节，backing storage 固定 43,970,327 字节，DOM 固定 2 documents、521 nodes、560 listeners。仍存在小幅 JS 增长，不能宣称零泄漏。整机 Elftia GPU 进程 committed memory 在周期间非单调分配、关闭后回落；它不是 Rocut 独占 GPU 内存，也不能证明长期稳定上界。

真实本地 ASR 已在 `installed-asr-CBUdtN` 通过，当前运行时持久化时长修复在 `installed-asr-WZiJyc` 通过。性能 session 无需重跑 ASR 或重新下载模型。

## 探针入口与当前限制

Producer 中：

- `scripts/probe-owned-presentation-trace.mjs`：已安装身份和专用会话检查、20 秒采集、恢复。默认是精简 Chromium trace；`ROCUT_OBSERVE_GPU_COMPLETION=1` 改为 GPU 回调观察，不同时开启 trace；额外 `ROCUT_GPU_720P=1` 通过 UI 切换 720p，测后仅撤销自己确切的三个设置操作。
- `scripts/probe-owned-preview-session.mjs`：打开、关闭、seek、720p 设置与精确 Undo 恢复。初始设置必须是 1920×1080 preset、无 lastCustomCanvasSize、30fps；不适配其他任意用户项目。
- `scripts/probe-webgpu-preview.mjs`：从唯一预览 canvas 获取现有 device，不修改 GPUQueue 或渲染方法；复用运行时 opt-in 样本入口。观察器及完成队列有上限、所有权检查和停止超时。
- `scripts/probe-webgpu-preview-report.mjs`：逐条关联提交与回调，检查尺寸、完整性、时序和热身样本，再计算诊断分位数。
- `scripts/probe-private-trace.mjs`：有界 trace 收集，拒绝数据丢失并关闭流。
- `scripts/probe-presentation-report.mjs`：User Timing 标记隔离进程，字符串 async ID 配对。不使用已被 JSON 舍入的 int64 surface ID。
- `scripts/probe-installed-gpu-memory.mjs`：已有 F05 资源观察入口，先读其环境约束再运行。
- `scripts/probe-elftia-interactions.mjs --motion-playback-only`：创建新 F04、调用下述 180 秒播放检查；它与 20 秒探针的恢复行为不同，先阅读入口，不能假定自动恢复上一个项目。

Rocut 中：`script/probe-preview-playback.mjs` 是现有 180 秒真实音频及提交耗时检查；`packages/editor-classic/src/diagnostics/preview-perf.ts` 明确只测提交；`script/probe-preview-screencast.mjs` 有已知长周期冻结记录。不要在没有新诊断问题时重复完整堆快照或数千次 seek。

Chromium 语义已核对对应版本的 `cc/metrics/compositor_frame_reporter.cc`。当前 web search 工具不可用；此前通过 `curl.exe` 只读访问 chromium.googlesource.com 成功。不必重新抓取大 trace 来重复已确认的 schema。

## 可复现的短测命令

以下在 Elftia 主仓库运行，只能在取得该实例独占测试时段后执行。命令不会下载模型或替换插件。

```powershell
$env:ELFTIA_WORKTREE = 'E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia'
$env:ROCUT_WORKTREE = 'E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut'
$env:ELFTIA_TEST_SESSION = '5b7fd2fa-b386-4f15-ab52-98514193ddd8'
$env:ELFTIA_CLI_DEBUG_PORT = '9361'
$env:ELFTIA_INSTALLED_ROCUT = Join-Path $env:USERPROFILE '.elftia/plugins/rocut'
$env:ELFTIA_REUSE_TEST_PROJECT = Join-Path $env:ELFTIA_WORKTREE '.tmp-rocut-e2e/project/rocut/live-1791270412882'
$env:ELFTIA_RESTORE_TEST_PROJECT = Join-Path $env:ELFTIA_WORKTREE '.tmp-rocut-e2e/project/rocut/live-1791270471948'
$env:ROCUT_OBSERVE_GPU_COMPLETION = '1'
$env:ROCUT_GPU_720P = '1'
node node_modules/tsx/dist/cli.mjs ../elftia-plugin-rocut/scripts/probe-owned-presentation-trace.mjs
```

切回默认 trace 前清除两个 `ROCUT_*` 模式变量，避免误判模式。F05 已有项目为专用目录下 `rocut/live-1791142097939`。切换项目之前必须确认活跃会话归属；不要输出 editorUrl。

在 producer 中运行探针回归：

```powershell
node --test scripts/__tests__/probe-presentation-report.test.mjs scripts/__tests__/probe-private-trace.test.mjs scripts/__tests__/probe-webgpu-preview.test.mjs scripts/__tests__/probe-webgpu-preview-report.test.mjs
```

## 接手后优先顺序

1. 核实 Git 状态、实例归属、当前项目、安装 app 摘要；确认没有另一 session 操作实例。先读已有证据，不立即重跑相同实验。
2. 确定完整播放的可信测量方案。GPU 回调已经补齐提交后的队列完成，但实际画面呈现关联和观察器开销仍待解决。不要把编辑器控件刷新当视频帧，也不要把截图编码耗时称为 GPU 时间。
3. 在冻结运行时上完成真实 720p、180 秒 F04 的持续播放与音频检查，保留全部原始样本和失败；沿用原阈值，不用短测覆盖长测。
4. 对 F05 剩余 JS 增长提出具体可检验的问题，区分 V8 代码缓存、普通对象和 GPU 资源。已有观测不支持无限期线性增长结论，也不支持零泄漏结论。
5. 对照当前候选版本收齐 seek、编辑、取消及资源证据。版本未变、相关路径未变的已通过检查不机械重跑；新运行时发布后重新判断受影响范围。
6. 形成性能 sidecar 与最终 12 步验收所需的素材身份、环境、版本和脱敏文件闭包。`bun run check:motion-text:installed-acceptance -- --manifest <evidence-root>/acceptance.json` 必须指向真实证据；不能写假布尔值让门禁通过。
7. 给原开发 session 交回性能结论、未通过项、复现命令、运行时 pin、相关文件和有证据支撑的优化建议。发现产品根因后协调修改，不能单方面更换共享安装。

## 给新 Session 的启动说明

请接手本仓库 `docs/performance-session-handoff.md` 定义的 Rocut 实际安装性能验收。原 session 继续功能开发；你负责性能探针与证据，先核实当前环境和版本，不走 Rasen，不启动子 agent，不提交 Elftia 主仓库。不要降低门槛或把 GPU 回调、UI 刷新率当作视频实际呈现；保留失败证据。当前短测和 F05 观察仅是诊断，完整性能验收仍未完成。先阅读本文并确认共享实例独占，再继续下一项有明确诊断问题的工作。
