---
name: rocut-studio
description: Drive the rocut video editor through its bundled CLI — start or join a local backend host, show its authenticated editor URL in the user's workspace Web Pane, edit tracks/clips/assets/markers through revision-checked transaction batches via --target routing, verify structurally by re-reading, export the finished timeline to an mp4 or webm file through the user's open editor pane, and rely on the project directory as the single source of truth. Use whenever the user wants to create or edit a video project, timeline, tracks, clips, markers, or project settings in rocut.
---

# rocut video editor (via the rocut CLI)

You operate rocut through its CLI — the sole automation surface rocut ships
(rocut deliberately ships no MCP). The user watches in the live editor; you
never drive the UI itself — all edits go through the CLI's transaction API and
the surface live-syncs.

## Environment — this plugin BUNDLES rocut

The plugin ships the built rocut runtime (see `vendor/PROVENANCE.md` for the
exact upstream commit). Paths below are relative to THIS skill's directory,
shown in the skill metadata trailer when you load it — call it `$SKILL_DIR`:

- CLI entry: `$SKILL_DIR/../../vendor/run/rocut.mjs`
- Editor surface (for `--static`): `$SKILL_DIR/../../vendor/surface`
- `vendor/run/chunk-*.js` and `vendor/run/opencut_wasm_bg.wasm` are load-bearing
  SIBLINGS of the entry (a chunk imports the wasm by filename) — never move or
  delete them

Prerequisite check, once per session:

```bash
node --version   # need >= 20; if node is missing/older, tell the user to install Node 20+
```

Invoke the CLI as `node <entry> <command>`:

```bash
node $SKILL_DIR/../../vendor/run/rocut.mjs target list
```

There is no other copy to reach for. Do not look for a rocut checkout, a
`$ROCUT` directory, `bun`, or a globally installed `rocut` — the plugin is
self-contained and those paths do not exist on a user's machine.

The packed `vendor/surface` is built with a **relative** asset base. That is
load-bearing: the host serves the editor under an authenticated `/<token>/`
prefix, and absolute asset paths escape it and answer 401. Always pass the
packed `vendor/surface` as `--static`; never substitute another build unless it
too was built with a relative base.

Times are `MediaTime`: safe integers at **120,000 ticks per second** (e.g. one
second = 120000, one 30fps frame = 4000).

### Older projects migrate automatically — no flag, no special handling

Opening a project directory whose `project.json` was written by an **older
rocut schema** runs the record-migration chain and writes the upgraded record
back, in the same `host ensure` call. There is nothing for you to do and no
environment variable to set: the bundled runtime instantiates the WebAssembly
core explicitly, so no experimental Node flag is involved.

If you have seen `NODE_OPTIONS=--experimental-wasm-modules` recommended for
rocut anywhere, it is stale advice from before this plugin bundled its runtime.
Do not set it and do not suggest it — it does nothing here.

Migration is one-way and in-place: the record is rewritten at the current
schema. If the user needs the old file, tell them to copy the project directory
BEFORE you open it, not after.

## Creator Studio projects

Keep the Creator Studio session working directory as the project root. The rocut workspace Tab manages tool projects under `rocut/`; inspect `target list` and reuse the exact existing project and explicit target id. Do not create a second timeline at the root or replace the session working directory with a tool subfolder. If its editor is already visible in a workspace Tab, do not call WebPane again; the existing pane receives CLI edits live. Switching Canvas, Director, and rocut does not require restarting or stopping any host. Use the WebPane flow below only for an editor not already opened by the workspace.

## Standard live session flow

1. Join the project's host, starting one only if none is live. `host ensure` is
   the one verb that does both atomically — it reuses a live host for that
   project directory or starts one, and prints the same fields either way:

   ```bash
   node $SKILL_DIR/../../vendor/run/rocut.mjs host ensure <project-dir> \
     --static $SKILL_DIR/../../vendor/surface
   ```

   The output prints a **target id**, an **editorUrl**
   (`http://127.0.0.1:<port>/<token>/` — authenticated loopback), the **pid**,
   and a **state** of `started` or `reused`. Read `state` and tell the user
   which it was — joining someone's live session is not the same event as
   starting one.

   The project directory is the single source of truth: `<dir>/project.json`
   is created from a default seed if absent, and everything survives host
   restarts. The file is the full editor record (schemaVersion 31) with the
   transaction envelope — the pane's editor session reads and writes the SAME
   file through the host; your applies and the user's edits converge on it.

   (`host start <project-dir> --static ...` still exists and runs the host in
   the FOREGROUND, tied to your session. Prefer `host ensure`.)

2. Show the editor to the user with the **WebPane** tool (loopback http is
   allowed):

   ```text
   WebPane { url: <editorUrl from host ensure>, title: "rocut — <project>" }
   ```

   Do NOT fabricate or transform the URL — pass the exact `editorUrl`
   returned. NEVER strip the token from the path: the bare origin only answers
   401. `target list` output deliberately has NO editorUrl (credential URLs
   are printed only on explicit `host start` / `host ensure`) — but a lost
   editorUrl is RECOVERABLE without touching the running host. Re-running
   `host ensure` on the same project directory reprints it and reuses the
   existing host; failing that, the target's secret file holds the port and the
   token, and the URL is exactly `http://127.0.0.1:<port>/<token>/`.

   ```bash
   # <root> = --targets-root, else $ROCUT_TARGETS_ROOT, else ~/.rocut
   # <id>   = the target id from `target list` (the sanitized project-dir basename)
   cat <root>/targets/<id>.json    # -> { "id", "port", "token" }
   ```

   NEVER restart the host to get a fresh URL: the pane you would kill may be
   the one a user is editing in right now.

   The pane live-syncs your commits (revision events) — the user SEES your
   edits appear. Their own edits save back through the host with
   revision-checked safety: nobody silently clobbers anybody.

3. Route mutations through the live target — and make sure it is YOUR project
   before you mutate anything. `--target auto` resolves NEWEST-FIRST,
   FIRST-ALIVE: it filters by target id when you pass one, and never by
   project directory, even though the registry records one. So with two live
   hosts on the machine, `auto` can hand a session working on project B the
   host serving project A, and every `apply` after that lands in the wrong
   `project.json` — silently, no error, no conflict, because that host really
   is live and really does accept the batch.

   Prefer an explicit target id over `auto`. rocut makes that easy: the target
   id IS the project directory's basename, sanitized to `[A-Za-z0-9._-]`, and
   `host ensure` printed it. Set it once and use it in every later command —
   every example below does:

   ```bash
   node $SKILL_DIR/../../vendor/run/rocut.mjs target list   # id / port= / pid= / project= / started=
   TARGET=<the target id host ensure printed>               # = project-dir basename, sanitized
   ```

   Confirm against `target list` that the `project=` recorded for `$TARGET` is
   your project directory, before the first mutation. If you ever do fall back
   to `--target auto`, check that same field on the entry `auto` will resolve
   to — the first row whose pid is still ALIVE, which is not always the first
   row printed, because the listing does not filter dead entries.

## Editing — transaction batches

Write an operations JSON file, then apply it. Operation kinds: `create-track`,
`update-track`, `delete-track`, `create-clip`, `update-clip`, `delete-clip`,
`create-asset`, `delete-asset`, `create-marker`, `update-marker`,
`delete-marker`, `update-project`.

```bash
# read current state first (never guess ids)
node $SKILL_DIR/../../vendor/run/rocut.mjs read --target "$TARGET"

# apply a batch (atomic: all-or-nothing; revision-checked)
node $SKILL_DIR/../../vendor/run/rocut.mjs apply ops.json --target "$TARGET"
```

`ops.json` shape:

```json
{
  "operations": [
    { "kind": "create-track", "track": { "id": "t1", "kind": "graphic", "name": "Titles", "hidden": false } }
  ],
  "expectedRevision": 0,
  "idempotencyKey": "optional-stable-key"
}
```

- A batch is **atomic**: any failing operation rejects the whole batch and the
  revision does not move.
- A fresh project seeds with one video **main track** named `Main Track`
  (revision 0) — it appears in `read` output and cannot be removed or retyped;
  build your clips onto it.
- `expectedRevision` enables optimistic concurrency — a mismatch rejects with
  `conflict` carrying the expected/actual revisions. A conflict is NORMAL when
  the user is editing at the same time, not a fault: re-`read`, rebuild the
  batch against the current revision, and apply again. Don't report it to the
  user as an error.
- `idempotencyKey` deduplicates retries: the same key + same operations
  returns the original result; the same key + different operations rejects
  with `duplicate`.

## Verify before claiming success

- Structural: `read --target "$TARGET"` after edits — confirm tracks/clips counts
  and the revision advanced. The apply result also returns `createdIds`/
  `changedIds`; treat those as evidence, then re-read to confirm.
- Composed-frame proof: `verify <tick> --target "$TARGET"` returns the frame at a
  MediaTime tick as a deterministic SHA-256 digest (plus frameIndex and the
  ordered element list). Same project revision + same tick = same digest on
  every machine, so you can assert "the frame at t is exactly what I
  composed" — capture the digest after an edit and re-verify to detect drift.
  Honest limit: this proves the COMPOSITION (elements, timing, geometry,
  text, z-order, asset identities), not rasterization — pixels still belong
  to the pane; for look-and-feel confirmations tell the user to look.

## Export — turning the timeline into a file

```bash
node $SKILL_DIR/../../vendor/run/rocut.mjs export --out ./final-cut.mp4 --target "$TARGET"
# --format mp4|webm (default mp4)  --quality low|medium|high|very_high (default high)
# --no-audio to skip the audio pass
```

Blocks until the render settles, prints progress to stderr, and writes JSON to
stdout with `status`, `hostPath` (inside the project's `exports/`) and, when
`--out` was given, `outputPath`.

**THE PANE MUST BE OPEN.** This is not a caveat to work around — it is how
export works here. Rendering needs a GPU graphics stack (a 2D canvas context,
WebGL for the compositor, WebCodecs for the encoder) and the host is a plain
Node process that has none of them. So the host directs the editor pane the
user already has open, and the pane renders. With no pane attached the command
fails immediately and says so:

```
POST /export failed (409): no editor pane is attached to this host, so there is
no renderer to export with — open the project's editor URL and retry
```

When you hit that, do not retry in a loop and do not report a broken export.
Show the user the `editorUrl` (from `host ensure` / `target list`) and ask them
to open it, then run the command again.

Consequences worth knowing:

- The user WATCHES the export happen — it renders in their pane, so the
  progress you print and what they see are the same run.
- One render at a time per pane. A second concurrent export is refused rather
  than queued.
- Closing or reloading the pane mid-render abandons that render; the job then
  settles as failed rather than hanging forever.
- There is no `--fps` override. The export uses the project's own frame rate,
  which is nearly always what is wanted; frame rates are rationals (29.97 is
  30000/1001) and a decimal override would silently drift.
- Verify the result the way you verify anything else: check the file exists and
  is non-trivial in size. `verify <tick>` proves COMPOSITION, not the encoded
  pixels — for look-and-feel, tell the user to watch it.

## Drafts (review-before-commit)

Multi-step or creative changes go through a draft so the user can review in
the pane before anything is committed:

```bash
CLI="$SKILL_DIR/../../vendor/run/rocut.mjs"
DRAFT=$(node "$CLI" draft begin --target "$TARGET")
node "$CLI" draft stage ops.json --draft "$DRAFT" --target "$TARGET"
node "$CLI" draft approve --draft "$DRAFT" --target "$TARGET"   # or reject / discard
```

- `approve` applies the whole staged journal as one atomic commit (one
  revision bump, one undo step).
- `reject` is a judged refusal; `discard` means nobody judged it — the outcome
  carries `reason: "rejected" | "discarded" | "expired"` so you can tell the
  user whether retrying the same work makes sense.
- If the user SAVES in the pane while your draft is open, the draft dies with
  the record it was staged against: the next draft verb returns `404
  unknown-draft`. That is the deterministic rule, not a failure — a draft you
  staged for review can be GONE when you come back to it, so re-check before
  acting on it: re-`read`, restage against the current state, and tell the user
  their edit landed.
- Tell the user a draft is awaiting their review — they approve visually in
  the pane, not through you.
- The human review gate is the entire point of a draft. Never select an
  approval mode that commits without a human looking — if a verb offers one,
  that option is not for you. Work that should not wait for review does not
  need a draft; use `apply`.

## Host-lifetime honesty

The host is NOT yours. It is an independent process bound to a project
DIRECTORY, not to your session, and you are one client among several: the user
editing in the pane, another agent session, and an external CLI client can all
be attached to the same host at once. `target list` shows every live target on
the machine, not just the ones you started.

- Never stop a host you did not start.
- Don't assume you may stop one you did start either — someone may still be
  editing in the pane it serves. Leave it running and say so.
- To continue on a project: `host ensure` for that directory and read the
  `state` it reports; `started` means there was nothing to join. The project
  directory is the source of truth, so a host that is already gone costs you
  nothing.

## Hard rules

- Never edit `<project-dir>/project.json` by hand — always via `apply`
  (revision checks, atomicity, and watch events live there).
- Never guess track/clip/asset/marker ids — read them from `read` output.
- Never mutate through a target you have not confirmed is your project —
  `--target auto` is project-blind (step 3), and picking wrong corrupts
  someone else's project instead of failing.
- One host per project directory; don't start a second host for the same
  directory — the target id is the directory's basename, so a second start
  overwrites the first one's registry entry and secret while the first process
  is still alive, still holding its port, still writing the same
  `project.json`. `host ensure` is the verb that cannot make this mistake.
- Never stop a host to "clean up" or to re-print a URL; re-run `host ensure`,
  or recover the URL from the secret file instead.
- The WebPane tool only accepts https or loopback http URLs.
