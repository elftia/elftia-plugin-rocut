# Vocaloid 风格 MV 管线：Creator Studio / Rocut 功能覆盖与缺口审查

审查日期：2026-10-06。状态：静态审查完成，待选择下一步路线。

> 后续范围更新：Creator Studio 的 [MV skill](../../elftia-plugin-creator-studio/resources/agent/skills/vocaloid-style-mv/SKILL.md) 已新增制作方法及本地音乐分析/分离/对齐脚本，Rocut Agent 接口由独立 session 补齐；下文 G1/G2/G3/G4 是原审查快照，不应作为这些工作仍全部空缺的结论。原 HTML Video 能力收进 Creator Studio 后，场景/后期已有 Remotion、HTML/GSAP 等制作底座，重点转为场景配方、确定性帧接口、分层产物和跨工具融合。新的优先顺序及接口设计见 [MV 镜头制作与多引擎融合方案](../../elftia-plugin-creator-studio/docs/mv-compositing-integration.md)：先集成，再做完整 MV E2E；源码新增不等于安装/模型/跨工具验收已通过。

本文回答：`vocaloid-style-mv-pipeline` 的哪些能力已可由 Elftia / Creator Studio / Rocut 承担，哪些还依赖外部工具，哪些需要补齐，以及现在是否适合开始一次 MV E2E。

本轮不实现功能、不运行参考项目、不安装依赖或下载模型、不接入 Blender、不启动新 E2E。性能工作由另一个 session 负责，不在本文重新拆解或安排。本文也不扩大 [可选增强清单](optional-enhancements.md) 中在线 Sounds 等工作的范围。

## 1. 结论

**Creator Studio 可以成为这类 MV 制作的编排入口，Rocut 可以成为最终可编辑工程和成片出口；但目前不能认定“加上 Blender MCP 就已完整覆盖”，也不能认定“Rocut 已覆盖除 Blender 外的全部功能”。**

关键原因有五个：

1. **参考项目不是另一个剪辑器。** 它是创作方法、歌曲/歌词分析工具、素材处理脚本、独立场景渲染器、Blender 镜头配方和交付检查流程的组合。JIZURA 只负责其中的歌词动效层。
2. **Rocut 已有的编辑基础很有价值。** 多轨素材组合、原生 motion-text、LRC、预设、时间编辑、锁定/变体、撤销重做和音视频导出已经有源码与既往安装验收证据，不需要重新做一套文字 PV 编辑器。
3. **音乐分析和歌词对齐仍存在实质差距。** 当前 Rocut 是能量分析、固定 BPM/首拍网格及普通 ASR 字幕；参考项目还包含随时间变化的拍点、下拍/小节/段落、分频包络、人声分离和以官方歌词为准的日语 mora 强制对齐。
4. **“有预设”不等于“有整套场景引擎”。** 参考项目另有 24 个场景、13 种场景转场及分层后期。Rocut 的 JIZURA 文字预设数量不能作为这些能力的覆盖证明；Rocut UI 能做的精细编辑，也并非都已暴露为稳定 Agent 事务接口。
5. **Blender MCP 只解决控制入口的一部分。** 仍需可复用的 toon 材质/镜头制作方法、可靠渲染任务、产物路径与时间契约、失败恢复及导入验收。参考项目本身使用 Blender Python CLI，不以 MCP 为前提。

因此应区分三个目标：

| 目标 | 当前判断 |
|---|---|
| 做出同类风格的 MV 成片，允许外部工具预渲染镜头 | 已具备可组合的基础，适合设计有限范围 E2E；尚未验证本项目级闭环 |
| 主要内容在 Rocut 中保留原生编辑能力，并由 Creator Agent 完成制作 | 部分具备，受精细编辑接口、音乐/歌词数据和场景能力限制 |
| 完整替代参考管线，或导入其 `timeline.js` 后原样重放 | 当前不具备；不能通过已有 JIZURA 集成推导成立 |

“将最终视频导入 Rocut”只证明素材可接收，不能算作场景、歌词、粒子、灯光或 3D 参数在 Rocut 内可编辑。

## 2. 审查基线与证据等级

### 2.1 本地版本

| 对象 | 本轮读取基线 | 注意事项 |
|---|---|---|
| `vocaloid-style-mv-pipeline` | `13b380dab077d4c8ea956825c9693c720e0c2b91` | 工作树干净；阅读 README、references、模板和关键实现，未执行 |
| Rocut 源码 | `2ee4d5c9d8b0ff9a48c386b33e151072baf51150` | 存在未跟踪开发目录，未操作；不等同于安装 runtime 的版本 |
| Rocut plugin producer | `e942b22fc2432ab3eb6b049e68a97e109f5a75b6` | 插件 manifest 为 `0.5.0`；[upstream.json](../upstream.json) pin 为 `1b2d820822cf47d74ae2bdd5d6ba29d6d7eaa42b` |
| Creator Studio producer | `56f1c2db673d5a5edf21295b78eacca13f0e7ac2` | 插件版本 `0.1.5`，agent package 版本 `1.0.1`；本轮读取包含已有未提交的 prompt/skill/command 修改 |
| Elftia 主仓库 | `5de8bf11e1e1bf2a463e79e2cbcc070ea55b0523` | 工作树已有其他修改；本轮未改动主仓库 |

插件版本、Rocut SDK 包版本、runtime commit、Creator agent package 版本是不同维度，不能用一个版本号替代全部状态。以上是本地快照，不代表远端最新发布。

### 2.2 状态含义

- **已有**：能定位到相应源码或接口；具体安装证据另行说明。
- **部分**：覆盖其中一部分，或可以手工组合，但不具备完整语义/自动化闭环。
- **外部依赖**：应由生成服务、Blender、音频分析器等承担，不属于 Rocut 内建能力。
- **缺口**：在本轮核查的数据契约和执行入口中没有对应能力，且不能用相邻功能替代。
- **待验证**：源码接缝存在，但缺少该素材、该 provider 或该宿主路径的实际运行证据。

既往 [Rocut 安装验收记录][R-acceptance] 中，runtime `1b2d8208` 的 `live-jVQHOT` 已通过 35/35 连续功能检查，包括实际 Creator 入口、同工程编辑/历史、全文与非零起点选区音视频导出、Agent 冲突/审批及字体错误恢复。它不等于已经制作并验收了一支本参考项目复杂度的 MV。

真实本地 ASR 记录是在较早 runtime `aff5ec05` 上，以生成的英文语音测试默认 Whisper-small q4；它不证明日语歌唱识别、人声分离或官方歌词强制对齐已经通过。此次未连接运行中的 Elftia，也未重新检查实际安装内容，安装结论仅引用既有记录。

## 3. 参考项目到底提供什么

### 3.1 制作链路

歌曲与官方歌词 → 创意/角色/色彩脚本 → 音频结构与歌词时间 → 分镜及素材清单 → 图片生成与透明素材处理 → 2D/文字/Blender 镜头 → 时间驱动合成 → 横版与竖版重排 → 静帧/联系表/成片检查 → 多规格交付。

核心不是“点击某个预设”，而是把歌曲时间、小节、歌词、镜头、资产和视觉风格组织成一致的项目。

### 3.2 JIZURA 之外的独立部分

- `template/tools/analyze_audio.py` 使用 librosa 拍点跟踪及 tempo curve；产出拍点、小节、段落、停顿等分析，另有分频/人声包络供场景驱动。
- `transcribe_*` 系列包含人声分离、Whisper 辅助识别、候选检查、日语读音/mora 强制对齐、人工修订和导出。官方歌词是文本真值，不是直接采纳 ASR 文本。
- `engine/core/main.js` 明确管理 scene、text、foreground 三层；WebGL2 后期对各层采用不同处理，支持“歌词在人物后面，但文字不随背景一起模糊/扰动”。
- 已从源码注册调用核对 **24 个场景**，包括 `illust`、`panels`、`burst`、`ref`、`seq`、`kanjiSlam`、`heart`、`fall`、`train` 等；并核对 **13 个场景转场**：cut、xfade、flash、black、iris、irisClose、barrier、wipe、slices、push、zoom、ink、shatter。
- `vertical.js` 不是只改分辨率：它复用无歌词画面，重新组织画面带/环境背景/标题，并在 9:16 下重新规划歌词。
- `blender_run.py` 调用 `blender -b ... -P <script>`；镜头脚本和共用 helper 承担具体美术与动画实现。MCP 并不在这条原始执行链中。

证据：[音频脚本][V-audio]、[强制对齐脚本][V-align]、[引擎说明][V-engine]、[主合成入口][V-main]、[场景目录][V-scenes]、[转场实现][V-trans]、[竖版实现][V-vertical]、[Blender runner][V-blender-run]。

### 3.3 参考项目自身也有边界

- 它是脚本模板与方法论，不是已经产品化的一键 MV 服务；分析、分镜、挑选和美术检查仍需人为判断。
- 音频分析按 4/4 组织下拍和小节，不能据此宣称任意拍号通用；段落表支持人工策划，自动分析只是辅助。
- mora/假名/罗马字处理针对日语。中文、英文等不能直接套用同一套对齐逻辑。
- 一部分场景写死了《残光》的文字、色调、图像像素锚点和事件时间；迁移到新歌需要改配方，不是仅换图片。
- 其 JIZURA pin 为 `fc16bfe43ea4a6c25a21f1caf04d17326de14f00`。Rocut 使用自己的 Rust 规划、原生 renderer 和导入兼容性规则；不能承诺相同 seed 或相同预设名生成逐像素一致画面。
- 代码/skill 的 MIT 声明不覆盖案例歌曲、歌词、角色和图片；仓库没有完整歌曲音频和原尺寸美术素材。E2E 应使用自制或明确授权素材。若复用代码、字体或模型，还需保留对应来源与许可声明，不能把项目 MIT 当作全部依赖的统一许可。

证据：[参考项目说明][V-readme]、[JIZURA 接线说明][V-jizura]、[音频/歌词说明][V-lyrics]、[第三方声明][V-notices]。

## 4. 功能覆盖矩阵

“现状”同时考虑产品能力与实际自动化入口；“差距”不是全部要求立即开发。

| 功能 | 参考项目的能力 | Elftia / Creator / Rocut 现状 | 判断与差距 |
|---|---|---|---|
| 创意、分镜、色彩/角色设定 | MV 专用方法、角色 bible、镜头与素材清单 | Creator 有需求→分镜→关键帧→动态→成片五阶段和画布 | **部分**：通用编排已有；MV 专用方法、音乐段落映射与检查点未内建。[C-agent] |
| 图片/视频/音乐生成 | 图片生成包装器、参考图一致性方法 | Elftia media toolkit 有单次/批量生成，取决于用户 provider | **已有接缝 / 待验证**：模型支持、参考图一致性、透明输出质量不能由接口存在推断。[E-media] |
| 生成资产本地化 | 素材落到项目目录 | bridge 在视频请求带 `sessionId + messageId` 时已下载存储并返回绝对 `filePath` | **条件已有**：不是“所有视频仍只有 URL”；无 session keys 仍为 URL 路径，实际 Creator 调用需验收。[E-bridge] |
| 角色透明素材与边缘检查 | alpha key/trim/normalize、黑白底预览、halo 检查 | Rocut 能合成透明图片；Creator 通用生成不等于已有此加工流水线 | **部分 / 外部依赖**：未确认等价的产品内批处理与质量检查链；不能用本开发会话的抠图 skill 当产品能力。[V-assets] |
| 歌曲 BPM、首拍、能量 | tempo curve、真实拍点及多维包络 | Rocut Rust 有能量、BPM、首拍、置信度及固定网格、手工覆盖 | **部分**：固定网格不能替代变速拍点；存在 `beats` 数组并不代表当前支持 tempo map。[R-audio] |
| 下拍/小节/段落/停顿 | 4/4 下拍、小节、sections、stops、impacts | Rocut 有时间标记，可人工表达部分结果 | **缺口**：无等价统一音乐结构模型和分析/导入接口。[R-domain]、[V-audio] |
| 分频/人声驱动画面 | low/mid/high/onset/vocal + beat/bar phase 驱动 FX/镜头 | motion-text 绑定面向音源与时间同步 | **缺口**：没有参考项目式共享 envelope→任意场景/参数绑定契约；预设自身抖动不算音频反应。[R-motion]、[R-runtime] |
| 人声/伴奏分离 | UVR MDX-Net ONNX stems | Rocut 转录链是混音/媒体音频→ASR | **外部依赖 / 缺口**：未见内建分轨服务；外部生成 stems 后可作为普通音频导入。[V-lyrics]、[R-asr] |
| 普通自动字幕 | Whisper 辅助识别 | Rocut 有本地 Transformers ASR，返回文本片段时间 | **已有**：有英文真实语音历史验收；不代表歌唱、多语言或全部模型质量。[R-asr]、[R-acceptance] |
| 官方歌词强制对齐 | 官方文本 + vocal stem + MMS_FA mora + 人工修订 | Rocut 可导入 LRC、改 cue/cut 时间、tap/manual timing | **缺口**：没有 MMS 式强制对齐、置信度/候选/人工 override 的完整链；普通 ASR 不可替代。[V-align]、[R-motion] |
| 行/分切歌词动效 | LRC、强调、分切、间奏、多风格计划 | 原生 sequence/cue/cut，plain/LRC/JIZURA 导入、字体/配色、锁定/变体、center-free | **已有**：适合直接验证；任意单字独立图层不是当前粒度，精确字/音节 timing 仍需映射设计。[R-motion]、[R-support] |
| MV 风格预设筛选 | 镜头用途、mood、deny-list、配色方案组合 | Rocut 有 catalog、preset sets、指定/锁定预设和变体 | **部分**：有可选预设不等于参考项目按影片策划的池/方案已迁移；需做风格配方与兼容映射。[V-jizura]、[R-motion] |
| 图层与人物遮挡歌词 | scene→text→foreground | Rocut 图像/视频/文字/graphic 多轨按层序合成，motion-text 可 overlay | **已有基础 / 待验证**：可用背景→文字→透明人物组合，需验证具体遮挡、转场和导出，不需新造整个 compositor。[R-builder] |
| 2.5D 推拉、位置/透明度动画、遮罩 | illust 的 parallax、人物入出场、镜头运动 | Rocut UI 数据模型有 animations、effects、masks 和素材图层 | **部分**：人工组合可覆盖一部分；Agent 精细参数/关键帧接口并未与 UI 等量覆盖。[R-timeline]、[R-ops] |
| 程序化场景/粒子/角色局部运动 | 24 场景、雨/火/碎裂/头发条带形变、12fps 角色动作 | motion-text 内有相近视觉预设，但没有参考项目场景 API | **缺口或需外部预渲染**：不同对象和语义，不能按预设数量宣称已覆盖。[V-scenes]、[V-engine] |
| 镜头级转场 | 13 种场景转场 | 普通片段 `transitionIn` 为 `cross-dissolve`；文字动效另有其内部转场 | **部分**：普通片段切换/溶解已有；JIZURA 内部 `trans` 不等于任意素材间的 iris/ink/shatter。[R-domain]、[V-trans] |
| 变速、定格、倒放/引用场景 | ref 可定格、rewind、melt，并引用其他场景 | 普通视频支持正向 retime 与 source freezeFrame | **部分**：不能把正向变速/单帧定格视为嵌套场景引用或原生倒放；当前时间映射只采用正速率。[R-time]、[V-meta] |
| 分层后期与风格统一 | boil、LUT ramp、CA、bloom、grain；保护文字层 | 普通 effect 默认注册 blur/color-adjustment，另有 adjustment layer；文字 FX 在 motion-text 内 | **缺口**：未形成等价的全场景/分层风格链，不能把文字特效套用能力当全媒体后期能力。[R-effects]、[V-main] |
| Blender 3D 制作 | Python 镜头脚本、toon、Line Art、对拍动画、`.blend` | Elftia 有用户 MCP 注册与 agent 关联；Creator 当前工具页绑定 Director/Rocut | **外部依赖 / 待验证**：可接入不等于已经接入；本轮未检查用户 MCP 配置或实际 Blender。Director 白模也不等于这套 toon 场景。[E-mcp]、[C-project] |
| Blender 渲染交接 | JPEG 序列、帧偏移、fps、LRU、缺帧诊断；可制作额外 pass | 普通视频/图片导入可用 | **部分**：先转成视频可走资产路径；未见原生编号图片序列资产及深度/线稿多 pass 契约，透明视频需单独探测格式支持。[V-meta]、[R-timeline] |
| 横版成片导出 | 帧渲染+FFmpeg 音频 mux | Rocut attached pane 导出 MP4/WebM；Host 负责请求，不独立拥有像素 renderer | **已有**：已有全片/选区音视频安装证据；参考项目的全部编码参数并未因此覆盖。[R-export]、[R-acceptance] |
| 竖版制作 | 原生歌词重排、画面带、氛围背景、片头特例 | Rocut 项目画布宽高可改，歌词按画布绘制，center-free 可配 | **部分**：能建竖版不等于自动重排；无同源横竖版联动配方、逐镜裁切策略及回写验证。[R-ops]、[V-vertical] |
| QA 与多规格交付 | 静帧、联系表、整片巡检、share/preview、ffprobe | Rocut 有 read/list/verify、实际导出测试；Creator 要求结构读回 | **部分**：MV 级视觉检查和多产物清单/编码验证需编排；帧摘要本身不证明可读性、角色一致性或色彩正确。[V-delivery]、[V-qa] |
| 对外分享 | 可选 gigafile 上传 | 不属于当前 Rocut 核心编辑职责 | **可选外部步骤**：不是本次 E2E 前置条件；发布必须单独获得授权，不默认上传素材或成片。[V-delivery] |

## 5. 关键缺口及正确归属

### G1：MV 专用编排与项目记录

**归属：Creator Studio 的可选 MV skill / 垂直工作流，而非 Rocut renderer。**

现有 Creator 明确是通用创作编排器，不预置所有垂直方法。可以借鉴参考项目的方法，形成角色设定、风格锚点、歌曲段落、镜头卡、资产清单、歌词版本、用户挑选记录和交付清单；不需要把完整 Claude/Codex 专用包装脚本直接塞进插件。

建议以项目本地 manifest 记录 `shotId`、歌曲时间、资产引用、歌词来源、外部镜头产物、Rocut project/clip/sequence ID 和验收证据。它是编排记录，不是第二份 Rocut 工程真值：实际剪辑内容由 Rocut 事务与读回结果决定。

验收重点：从新素材开始能恢复进度；已选角色/风格不会因重启丢失；重试不重复插入镜头；参考案例的固定标题、歌词和图像锚点不会泄漏到新项目。

### G2：音乐时间图与通用音频驱动

**归属：分析服务负责计算，Rocut 负责消费、编辑和持久化音乐时间信息。**

源码证据很明确：当前 `MotionTextAudioAnalysis` 有 energy、bpm、firstBeat、beats、confidence；但 `resolve_motion_text_beat_grid` 的结果由 BPM/firstBeat 生成固定网格，持久绑定也没有完整 tempo map、bar/section 或多频包络。不能仅将参考 `audio.json` 的字段改名后塞入现有 schema。

可分两步：

1. 先允许外部分析结果进入版本化、可校验的数据格式，并提供人工校正、来源与音频 digest；避免更换音源后继续使用旧分析。
2. 若要原生音频反应，再增加“包络/节拍事件→参数”的有限绑定和统一时间映射，明确 source offset、剪裁、变速与选区导出语义。

验收重点：变速节奏素材、中途静音、非零 clip 起点和裁剪后仍能准确定位；分析不可用时明确提示，不默认为固定 BPM 即成功。参考分析器的 4/4 限制必须显式保留。

### G3：官方歌词强制对齐和细粒度时序

**归属：外部/宿主侧对齐能力 + Rocut 歌词导入和人工修订。**

需要将“歌词文本真值”“机器识别候选”“时间估计”“用户修订”分开。当前 LRC/cue/cut 可以承接行级结果，但不完整表达词/字/mora 的独立时间、置信度与来源；`segments: string[]` 和 cut partition 也不是任意字形独立轨道。

若下一步只验证行级歌词 MV，可提供人工核对过的 LRC，不必先部署所有模型。若目标是自动精确对唱，则需先设计对齐输入/输出与映射，再集成分离/对齐服务；不应简单换更大的 Whisper 模型便宣称补齐。

验收重点：保留官方歌词原字、不用同音识别结果覆盖；句首/长音/间奏不漂移；人工修订和 locks 不被重跑覆盖；取消、模型失败与未授权下载可恢复。日语成功不自动扩展为中文/英文成功。

### G4：Agent 精细编辑接口与 UI 能力不对称

**归属：Rocut 的稳定契约、Rust 领域逻辑及 UI/CLI 共用执行路径。**

`timeline/types.ts` 的 UI 元素具有 params、animations、masks、effects；但公开 `Clip` 与事务操作目前主要暴露素材/时间、正向 retime、freeze、cross-dissolve、adjustment、motion-text 引用等。普通素材 transform、关键帧、mask 形状等尚未作为同等粒度的公共事务字段完整暴露。

因此要区别两种 E2E：

- **编辑器 UI E2E**：可通过真实界面验证这些功能；不证明 Creator Agent 只用受支持 CLI 就能自动完成。
- **Creator Agent E2E**：必须坚持受支持接口；接口缺失即记录为阻断，不通过写 `project.json`、内部 store 注入或任意 opaque patch 假装成功。

如果选择先补缺口，应先从短 MV 真正需要的最小动作集选取 transform、关键帧、图层控制等接口，保留 revision、审批、撤销重做和原子持久化语义，不一次性公开整个内部对象。

### G5：专用场景、转场与分层后期

**归属：通用可编辑能力放 Rocut；强风格、作品相关镜头先作为外部生成器/配方。**

可在 Rocut 内优先保留背景、透明人物、歌词和基础镜头动画。碎裂天空、手绘角色局部形变、特定列车场景等，不必为一次 MV 全部搬入核心编辑器。外部产物可以先以镜头视频交接，同时记录“已烘焙，不可原生编辑”。

若产品目标要求这些效果原生可改，再分别设计：媒体片段转场、时间驱动场景节点、分层 effect stack、可复用调色/风格预设。不要直接执行参考项目任意 `timeline.js`，也不要引入第二套 JIZURA runtime/工程来绕开现有 Rust owner。

验收重点：相同时间/seed 的 seek 与导出一致；文字可保持清晰；人物遮挡与转场不穿帮；修改局部镜头不会改变已锁定其他镜头。

### G6：Blender 生产与资产交接

**归属：Creator 编排 + Blender 工具提供方；Rocut 接收媒体资产。**

Elftia 的 MCP 底座支持用户配置和 agent 关联，不能因为 Creator manifest 未列 Blender 就判断完全无法接入；也不能因为底座存在就写成当前已安装可用。

接入前需明确：采用哪个 MCP server/插件及其允许动作，或是否使用更贴近参考项目的 headless Python runner；工作目录和输出目录；`.blend` 与镜头脚本保存；Blender 版本；fps/分辨率/帧范围；任务完成、失败、取消和重试信号。

第一阶段可以选“Blender→普通视频→Rocut”，验证时长、第一/最后一帧、歌曲全局时间和再导出。只有确有无损逐帧/透明/多 pass 编辑需求时，再考虑原生序列与 pass 支持。视频交接不会让 Rocut 获得 Blender 内部场景编辑能力。

### G7：横竖版联动与交付配方

**归属：Creator 交付编排 + Rocut 画布/布局能力。**

当前有画布尺寸和 center-free 能力，不代表参考项目的 `vertical.js` 可直接迁移。还需确定同源歌词如何跨版本同步、人物如何重构图、标题镜头何时保留完整画面，以及横版修改后如何更新竖版而不覆盖人工布局。

第一阶段可建两个独立工程，人工/Agent 分别构图，明确不是自动联动。输出格式方面，当前 Rocut exporter 走 MediaBunny/WebCodecs 的 MP4/AVC 或 WebM/VP9 及音频路径，不等同于参考 FFmpeg 的 NVENC CQ、x264 CRF、BT.709 tagging 和批量 share/preview 配方。

验收重点：竖版歌词确实重新布局而非裁剪横版视频；无脸部遮挡或页边溢出；横竖输出使用同一首歌/歌词版本；实际文件解码确认画幅、时长、音轨与颜色，不能仅检查导出任务成功。

### G8：MV 级 QA 与指导文档同步

**归属：Creator 工作流与 consumer 侧验收。**

应补镜头中点/转场/歌词进入退出的静帧、联系表、抽帧检查和用户审片记录。已有 `verify` 是结构/帧摘要证据，不代替观感、角色一致性、歌词可读性或闪烁风险检查；也不能把参考文档的单一闪烁频次建议当作完整安全认证。

另有一个已证实的文档过时点：Creator `creation-doctrine` 仍把视频描述为只返回远程 URL，而当前 Elftia bridge 已有 session-keyed 本地存储分支。后续应同步指导并验收真实调用是否提供 session keys；**不应重复开发已经存在的下载路径**。本轮只记录，没有改动另一仓库的 prompt/skill。

## 6. 下一步选择：先 E2E，还是先补缺口？

### 路线 A：先做有限范围 MV E2E

适合先回答：“现有 Rocut + Creator 能否完成一段实用、可继续编辑的歌词 MV？”这不是完整替代参考管线的验收。

建议 fixture：20–30 秒自制/授权音频、人工确认的 4–8 行 LRC、一个透明人物、两张背景、一个短视频镜头，制作 16:9 版本；竖版和 Blender 分别作为可选扩展用例。

| 步骤 | 验证内容 | 成功证据 |
|---|---|---|
| A0 能力预检 | 新建专用 Creator session/项目，记录实际 runtime、CLI 能力、字体；确认测试实例不被其他 session 使用 | 版本/target/路径记录；不操作真实用户剪辑项目 |
| A1 素材交接 | 本地文件→Rocut 资产→时间线；保持源音频真值 | 路径、hash、解码时长及 read-back；若未使用生成 provider，不计生成能力通过 |
| A2 原生歌词 | LRC→motion-text；编辑、锁定、变体、时间修订 | stable ID、双 revision、保存重开、Undo/Redo 与可见画面 |
| A3 分层画面 | 背景→歌词→透明人物；少量镜头切换 | 遮挡与透明边缘静帧；若关键帧靠 UI 完成，单独标注为 UI 用例，不冒充 Agent CLI 完成 |
| A4 导出/读回 | 全片与一个非零起点选区的音视频导出 | 独立解码后的画面、歌词时间、音轨和时长；工程仍可编辑 |
| A5 可选竖版 | 独立 9:16 构图，歌词重排 | 不是裁切后的横版成片；明确是否人工处理，不能计作自动横竖联动 |
| A6 可选 Blender | 接口已配置并另获执行范围后，生成一个 3–5 秒镜头并导入 | 实际 `.blend`/render 记录、视频帧范围、Rocut 资产与导出；未执行则保留未验收 |

路线 A 不宣称：自动歌曲结构分析、歌唱强制对齐、24 场景复刻、13 转场全覆盖、全自动角色一致性、原生 Blender 编辑或自动横竖版联动。

执行规则：不为完成 demo 临时改内部工程数据；遇到不支持的动作，记录“缺口 / UI 完成 / 外部烘焙”之一。可以完成较小目标，但不得把降级替代计作原目标通过。

### 路线 B：先补最小关键缺口

适合目标已经明确为“Creator Agent 自动完成可编辑 MV”，或必须验证官方歌词自动精确对唱。建议按依赖而非按场景数量推进：

1. **先确定成片与可编辑边界。** 列出哪些镜头允许外部烘焙，哪些参数必须留在 Rocut 内；明确验收是 UI 还是 Agent CLI 驱动。
2. **补 G1 与所需 G4。** 完成 MV 项目记录/方法和最小精细编辑接口；先打通一镜头可创建、修改、撤销、重开、导出的链路。
3. **按作品要求选择 G2/G3。** 有人工 LRC 可暂缓对齐模型；需要变速拍点/自动对唱则先建立音乐时间与歌词时序契约，再接分析服务。
4. **需要 3D 时补 G6。** 不需要 3D 的短片不以 Blender 安装为前置；需要时先验证一个镜头交接，不先做整套专用工作台。
5. **按真实镜头需求逐项补 G5/G7/G8。** 优先通用转场、分层效果、竖版配方和视觉 QA，不预先迁移全部残光场景。

每项关闭都需“契约/实现→定向测试→实际宿主项目→产物读回”证据。代码存在、单元测试通过、工具调用返回成功和成片看起来接近，分别是不同证据，不能互相替代。

### 建议

**若目的是尽快摸清现有编辑器的可用程度，建议先选路线 A；若要求从第一轮起就全程由 Creator Agent 自动精细编辑，建议先补 G4 的最小动作集，再做 A。**

不建议在第一次 MV E2E 前迁移整个参考引擎。它会同时引入新的音频模型、另一套场景渲染语义、外部依赖和特定作品假设，使“当前 Rocut 到底能做什么”反而难以验证。

当前状态仍是等待用户选择路线；本文不构成启动 E2E、下载模型、调用付费生成服务、安装/运行 Blender 或对外发布的执行指令。

## 7. 证据入口与复核方法

下面链接面向当前多仓库工作区；独立 clone 本仓库时，需要对应 sibling checkout。本文采用本地源码和既有验收记录，没有把 README 宣称当作本轮运行结果，也没有访问用户凭证/MCP 配置。

### 参考项目

- [README 与案例/许可边界][V-readme]；[音频与歌词方法][V-lyrics]；[素材处理方法][V-assets]。
- [音频分析实现][V-audio]（`track_beats` / `downbeat_analysis` / `build_sections`）；[日语强制对齐实现][V-align]。
- [引擎总览与移植限制][V-engine]；[主合成][V-main]；[24 场景源码][V-scenes]；[13 转场源码][V-trans]；[ref/seq][V-meta]。
- [JIZURA 适配方法][V-jizura]；[竖版重排][V-vertical]；[Blender 方法][V-blender]与 [CLI runner][V-blender-run]。
- [渲染交付][V-delivery]；[视觉 QA][V-qa]；[第三方声明][V-notices]。

### Rocut

- [公共领域模型][R-domain]、[公共事务操作][R-ops]、[UI 时间线模型][R-timeline]：用于区分 Agent 接口与 UI 能力。
- [motion-text 契约][R-motion]、[音频分析实现][R-audio]、[motion-text runtime][R-runtime]、[ASR worker][R-asr]。
- [图层/节点构建][R-builder]、[普通效果注册][R-effects]、[视频时间映射][R-time]、[导出实现][R-export]。
- [预设覆盖矩阵][R-support]：其早期安装状态不是最新状态；安装结论以 [修复/验收时间线][R-acceptance] 对应 runtime 的记录为准。

### Creator Studio / Elftia

- [Creator agent manifest][C-agent]、[创作规则][C-doctrine]、[项目工具绑定][C-project]。
- [媒体工具处理][E-media]、[媒体 bridge][E-bridge]：重点核查 session-keyed 视频落地，避免依据旧 prompt 重复列为未实现。
- [用户 MCP 服务][E-mcp]、[agent MCP 关联][E-agent-mcp]：证明接入底座存在，不证明具体 Blender server 已配置或可执行。

[V-readme]: ../../../_others/vocaloid-style-mv-pipeline/README.zh-CN.md
[V-lyrics]: ../../../_others/vocaloid-style-mv-pipeline/skills/vocaloid-style-mv/references/03-audio-and-lyrics.md
[V-assets]: ../../../_others/vocaloid-style-mv-pipeline/skills/vocaloid-style-mv/references/04-asset-generation.md
[V-audio]: ../../../_others/vocaloid-style-mv-pipeline/skills/vocaloid-style-mv/template/tools/analyze_audio.py
[V-align]: ../../../_others/vocaloid-style-mv-pipeline/skills/vocaloid-style-mv/template/tools/transcribe_align_mms.py
[V-engine]: ../../../_others/vocaloid-style-mv-pipeline/skills/vocaloid-style-mv/references/05-engine.md
[V-main]: ../../../_others/vocaloid-style-mv-pipeline/skills/vocaloid-style-mv/template/engine/core/main.js
[V-scenes]: ../../../_others/vocaloid-style-mv-pipeline/skills/vocaloid-style-mv/template/engine/scenes
[V-trans]: ../../../_others/vocaloid-style-mv-pipeline/skills/vocaloid-style-mv/template/engine/core/trans.js
[V-meta]: ../../../_others/vocaloid-style-mv-pipeline/skills/vocaloid-style-mv/template/engine/scenes/meta.js
[V-jizura]: ../../../_others/vocaloid-style-mv-pipeline/skills/vocaloid-style-mv/references/06-jizura.md
[V-vertical]: ../../../_others/vocaloid-style-mv-pipeline/skills/vocaloid-style-mv/template/engine/vertical.js
[V-blender]: ../../../_others/vocaloid-style-mv-pipeline/skills/vocaloid-style-mv/references/07-blender-3d.md
[V-blender-run]: ../../../_others/vocaloid-style-mv-pipeline/skills/vocaloid-style-mv/template/tools/blender_run.py
[V-delivery]: ../../../_others/vocaloid-style-mv-pipeline/skills/vocaloid-style-mv/references/08-render-and-delivery.md
[V-qa]: ../../../_others/vocaloid-style-mv-pipeline/skills/vocaloid-style-mv/references/09-qa-and-lessons.md
[V-notices]: ../../../_others/vocaloid-style-mv-pipeline/THIRD_PARTY_NOTICES.md
[R-domain]: ../../../_others/rocut/packages/editor-contracts/src/domain.ts
[R-ops]: ../../../_others/rocut/packages/editor-contracts/src/operations.ts
[R-timeline]: ../../../_others/rocut/packages/editor-classic/src/timeline/types.ts
[R-motion]: ../../../_others/rocut/packages/editor-contracts/src/motion-text.ts
[R-audio]: ../../../_others/rocut/rust/crates/motion-text/src/audio.rs
[R-runtime]: ../../../_others/rocut/packages/editor-classic/src/services/renderer/motion-text/runtime.ts
[R-asr]: ../../../_others/rocut/packages/editor-classic/src/services/transcription/worker.ts
[R-builder]: ../../../_others/rocut/packages/editor-classic/src/services/renderer/scene-builder.ts
[R-effects]: ../../../_others/rocut/packages/editor-classic/src/effects/definitions/index.ts
[R-time]: ../../../_others/rocut/rust/crates/time/src/video_time.rs
[R-export]: ../../../_others/rocut/packages/editor-classic/src/services/renderer/scene-exporter.ts
[R-support]: ../../../_others/rocut/docs/motion-text/capability-support.md
[R-acceptance]: ../../../_others/rocut/docs/elftia-integration-repair.md
[C-agent]: ../../elftia-plugin-creator-studio/resources/agent/manifest.json
[C-doctrine]: ../../elftia-plugin-creator-studio/resources/agent/skills/creation-doctrine/SKILL.md
[C-project]: ../../elftia-plugin-creator-studio/src/renderer/page/projectModel.ts
[E-media]: ../../elftia/packages/desktop/app/main/services/capabilities/tools/skill-toolkit/toolkits/media/handlers.ts
[E-bridge]: ../../elftia/packages/desktop/app/main/services/capabilities/media/bridge/MediaToolsBridge.ts
[E-mcp]: ../../elftia/packages/desktop/app/main/services/capabilities/tools/mcp-users/McpService.ts
[E-agent-mcp]: ../../elftia/packages/desktop/app/main/services/agent-core/agent/AgentManagementService.ts
