---
name: rocut-studio
description: Drive the rocut video editor through its CLI — start a local backend host, show its authenticated editor URL in the user's workspace Web Pane, edit tracks/clips/assets/markers through revision-checked transaction batches via --target routing, verify structurally by re-reading, and rely on the project directory as the single source of truth. Use whenever the user wants to create or edit a video project, timeline, tracks, clips, markers, or project settings in rocut.
---

# rocut video editor (via the rocut CLI)

You operate rocut through its CLI — the sole automation surface rocut ships
(rocut deliberately ships no MCP). The user watches in the live editor; you
never drive the UI itself — all edits go through the CLI's transaction API and
the surface live-syncs.

## Environment — this skill expects a local rocut checkout (S07 dogfood stage)

Until rocut ships a bundled launcher, the CLI runs from a source checkout with
bun:

```bash
bun --version   # need >= 1.2; if missing, tell the user to install bun
```

Define `$ROCUT` = the rocut repo root (default
`E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut`). Invoke the CLI
as:

```bash
bun $ROCUT/apps/cli/src/main.ts <command>
```

Times are `MediaTime`: safe integers at **120,000 ticks per second** (e.g. one
second = 120000, one 30fps frame = 4000).

## Standard live session flow

1. Start the host in the background (its lifetime is this session's), serving
   the built web surface so the pane shows a REAL editor on the same project:

   ```bash
   # build once per checkout — RELATIVE base is required (absolute asset
   # paths escape the /<token>/ prefix and 401):
   # (cd $ROCUT/apps/vite-example && OPENCUT_PUBLIC_BASE=./ bun run build)
   bun $ROCUT/apps/cli/src/main.ts host start <project-dir> --static $ROCUT/apps/vite-example/dist
   ```

   The output prints a **target id**, an **editorUrl**
   (`http://127.0.0.1:<port>/<token>/` — authenticated loopback), and the pid.
   The project directory is the single source of truth: `<dir>/project.json`
   is created from a default seed if absent, and everything survives host
   restarts. The file is the full editor record (schemaVersion 31) with the
   transaction envelope — the pane's editor session reads and writes the SAME
   file through the host; your applies and the user's edits converge on it.

2. Show the editor to the user with the **WebPane** tool (loopback http is
   allowed):

   ```text
   WebPane { url: <editorUrl from host start>, title: "rocut — <project>" }
   ```

   Do NOT fabricate or transform the URL — pass the exact `editorUrl`
   returned. NEVER strip the token from the path: the bare origin only answers
   401. `target list` output deliberately has NO editorUrl (credential URLs
   are printed only on explicit `host start`) — if you lost the editorUrl,
   stop the old host and `host start` again for the project directory, then
   use the fresh URL from your own output.

   The pane live-syncs your commits (revision events) — the user SEES your
   edits appear. Their own edits save back through the host with
   revision-checked safety: nobody silently clobbers anybody.

3. Route mutations through the live target: `--target auto` (or the printed
   target id).

## Editing — transaction batches

Write an operations JSON file, then apply it. Operation kinds: `create-track`,
`update-track`, `delete-track`, `create-clip`, `update-clip`, `delete-clip`,
`create-asset`, `delete-asset`, `create-marker`, `update-marker`,
`delete-marker`, `update-project`.

```bash
# read current state first (never guess ids)
bun $ROCUT/apps/cli/src/main.ts read --target auto

# apply a batch (atomic: all-or-nothing; revision-checked)
bun $ROCUT/apps/cli/src/main.ts apply ops.json --target auto
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
  `conflict` carrying the expected/actual revisions.
- `idempotencyKey` deduplicates retries: the same key + same operations
  returns the original result; the same key + different operations rejects
  with `duplicate`.

## Verify before claiming success

- Structural: `read --target auto` after edits — confirm tracks/clips counts
  and the revision advanced. The apply result also returns `createdIds`/
  `changedIds`; treat those as evidence, then re-read to confirm.
- Composed-frame proof: `verify <tick> --target auto` returns the frame at a
  MediaTime tick as a deterministic SHA-256 digest (plus frameIndex and the
  ordered element list). Same project revision + same tick = same digest on
  every machine, so you can assert "the frame at t is exactly what I
  composed" — capture the digest after an edit and re-verify to detect drift.
  Honest limit: this proves the COMPOSITION (elements, timing, geometry,
  text, z-order, asset identities), not rasterization — pixels still belong
  to the pane; for look-and-feel confirmations tell the user to look.

## Drafts (review-before-commit)

Multi-step or creative changes go through a draft so the user can review in
the pane before anything is committed:

```bash
DRAFT=$(bun $ROCUT/apps/cli/src/main.ts draft begin --target auto)
bun $ROCUT/apps/cli/src/main.ts draft stage ops.json --draft "$DRAFT" --target auto
bun $ROCUT/apps/cli/src/main.ts draft approve --draft "$DRAFT" --target auto   # or reject / discard
```

- `approve` applies the whole staged journal as one atomic commit (one
  revision bump, one undo step).
- `reject` is a judged refusal; `discard` means nobody judged it — the outcome
  carries `reason: "rejected" | "discarded" | "expired"` so you can tell the
  user whether retrying the same work makes sense.
- If the user SAVES in the pane while your draft is open, the draft dies with
  the record it was staged against: the next draft verb returns `404
  unknown-draft`. That is the deterministic rule, not a failure — re-`read`,
  restage against the current state, and tell the user their edit landed.
- Tell the user a draft is awaiting their review — they approve visually in
  the pane, not through you.

## Session-end honesty

The host is a background process of THIS session — when the session ends it is
reaped and the pane goes dark. That is expected. To continue later: `target
list` first (in case a host still runs); otherwise `host start` again — the
project directory is the source of truth and nothing is lost.

## Hard rules

- Never edit `<project-dir>/project.json` by hand — always via `apply`
  (revision checks, atomicity, and watch events live there).
- Never guess track/clip/asset/marker ids — read them from `read` output.
- One host per project directory; don't start a second host for the same
  directory.
- The WebPane tool only accepts https or loopback http URLs.
