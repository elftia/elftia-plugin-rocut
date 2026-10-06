# Native Agent editing

Use only capabilities present in the installed runtime. This reference covers
the Agent-first source interface; an older bundled runtime can lack it. Use the
bundled CLI and explicit target established by `SKILL.md`, never a source checkout:

```bash
node "$CLI" capabilities --target "$TARGET"
node "$CLI" editing catalog --target "$TARGET"
node "$CLI" read --target "$TARGET"
```

An unknown command or absent capability means this installation needs an update.
Do not change packages, restart a shared host, or write `project.json` to bypass it.
`capabilities` returns the Host context directly, including `supportedOperations`,
`editing`, `editorTasks` and `mediaImport`. `editing catalog` wraps its payload in
`catalog`; inspect `catalog.elements`, `catalog.effects`, etc., not top-level fields.

## Fine editing through ordinary transactions

Read the catalog for supported parameter names, defaults, units, ranges and
animation support. Use `apply` or reviewed drafts with the read `expectedRevision`
and a stable `idempotencyKey`. Read back after committing.

| Intent | Transaction surface |
| --- | --- |
| Ordinary text/font/style, position/scale/rotation/opacity/blend | `Clip.editing.params` |
| Scalar, discrete and color keyframes, easing/Bezier handles | `Clip.editing.animations` |
| Clip effects and their order | `Clip.editing.effects` |
| Masks on video/image/graphic elements | `Clip.editing.masks` |
| Native graphics/stickers | `editing.type`, `definitionId` / `stickerId`, catalog params |
| Volume/volume animation, source video audio | `editing.params.volume` in dB, `params.muted`, `animations`, `isSourceAudioEnabled` |
| Track mute/visibility | `update-track.patch.muted` / `hidden` |
| Project backdrop | `update-project.patch.background`: `{type:"color",color:"#123456"}` or `{type:"blur",blurIntensity:200}` (0–500) |
| Layer order | `reorder-tracks` with `trackIds`, an exact permutation of all current track IDs |
| Whole-frame effects | Effect track, `editing.type:"effect"`, `effectType` and complete effect params; color adjustment also supports `Clip.adjustment` |

`editing` is a **full replacement**, including its `params` and collections.
Start from the read object and change the intended fields; `{}` or `[]` clear
values. Do not send only an opacity field if text/font/other state must remain.
Copy complete defaults for new effects/masks before overriding individual values.
Omitting `editing` on an otherwise ordinary clip patch preserves existing editing.

Times are integer ticks (120,000/second); animation times are element-relative.
Keyframe IDs/times must be unique and times sorted. Color channels use linear
RGBA components; effect paths are `effects.<effect-id>.params.<parameter>` and
graphic-specific paths are `params.<parameter>`. Whole-frame effect-layer parameter
animation is not currently rendered and is rejected; clip-effect animation is supported.

Track ordering applies within each scene's overlay/audio group. The canonical
main track stays below overlays; reorder does not reparent tracks across scenes.
The main scene and each surviving scene's main-track identity are protected.

## Scene lifecycle

`read` includes all scenes. Filter by `Track.sceneId` / `Marker.sceneId` and
`projectEntity.sceneState.currentSceneId`; do not treat inactive scenes as current.

```bash
node "$CLI" scenes list --target "$TARGET"
node "$CLI" scenes plan scene.json --target "$TARGET"
```

Example `scene.json`:

```json
{"idempotencyKey":"scene-001","operation":{"kind":"create","id":"chorus","name":"Chorus","mainTrackId":"chorus-main"}}
```

Other operation kinds are `rename` (`id`, `name`), `switch` (`id`), `delete` (`id`).
Planning does not mutate. Save the returned batch, then submit that exact batch
via normal `apply` or a draft. Retry the saved batch, not a newly generated plan.
Scenes are independent timelines, not an automatically concatenated shot list.
For one continuous MV, arrange shots along one scene unless a separate scene is
intentional. Export operates on the active scene. Motion-text `scene`/`overlay`
render modes are unrelated to this project scene lifecycle.

## Captions and actual session history

```bash
node "$CLI" task list --target "$TARGET"
node "$CLI" task start task.json --target "$TARGET"
node "$CLI" task get <job-id> --target "$TARGET"
node "$CLI" task cancel <job-id> --target "$TARGET"
```

The selected editor pane must be attached. Multiple panes require `surfaceId`
from `task list`; do not guess which pane owns the desired history. Start returns
a job, not completion. Poll to a terminal status before using its result.
CLI task responses wrap the Host payload in `result`: panes are
`task list` → `result.surfaces`; the job is `task start|get` → `result`, its ID is
`result.id`, and a completed caption batch is `result.result.batch`. Extract that
batch only; passing the entire CLI output to `apply` is invalid.

Example `task.json`:

```json
{"surfaceId":"<from-task-list>","request":{"kind":"captions.import","expectedRevision":12,"idempotencyKey":"captions-001","sceneId":"chorus","trackId":"chorus-captions","fileName":"lyrics.srt","input":"1\n00:00:00,000 --> 00:00:02,000\nHello\n"}}
```

SRT/ASS import and `captions.transcribe` return cues, diagnostics and `result.batch`;
**they do not insert captions**. Save, review and explicitly apply that batch.
The source scene must be active. Revision changes during processing reject stale work.

For ASR, replace `kind` with `captions.transcribe`, omit `input`/`fileName`, optionally
specify `language` and `modelId` (e.g. `whisper-small`); discover supported choices
and the default in `editing catalog`'s `transcription` field. `allowModelDownload:true` is
mandatory and may cause a network download: obtain the user's authorization before
enabling it. Audio is processed locally. This is ordinary ASR, not singing/phoneme
forced alignment. Cancelling a caption task suppresses late results.

For history, requests have `kind:history.status|history.undo|history.redo`,
`expectedRevision` and `idempotencyKey`. They operate on that pane's actual command
stack. Undo/redo cannot be cancelled after dispatch. For `outcome-unknown`, inspect
the project's state; never retry blindly with a fresh key.

History is session-scoped: reload can clear it and Host/CLI applies are not
automatically enrolled. Draft compensation is a separate mechanism. Jobs and
their idempotency keys are Host-process-scoped (128 jobs); normal applied batches
retain durable replay. Do not promise cross-restart task/history recovery.
