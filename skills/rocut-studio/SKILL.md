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

1. Start the host in the background (its lifetime is this session's):

   ```bash
   bun $ROCUT/apps/cli/src/main.ts host start <project-dir>
   ```

   The output prints a **target id**, an **editorUrl**
   (`http://127.0.0.1:<port>/<token>/` — authenticated loopback), and the pid.
   The project directory is the single source of truth: `<dir>/project.json`
   is created from a default seed if absent, and everything survives host
   restarts.

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
- `expectedRevision` enables optimistic concurrency — a mismatch rejects with
  `conflict` carrying the expected/actual revisions.
- `idempotencyKey` deduplicates retries: the same key + same operations
  returns the original result; the same key + different operations rejects
  with `duplicate`.

## Verify before claiming success

- Structural: `read --target auto` after edits — confirm tracks/clips counts
  and the revision advanced. The apply result also returns `createdIds`/
  `changedIds`; treat those as evidence, then re-read to confirm.
- Composed-frame visual verification (deterministic wasm rendering) is **not
  yet exposed through this CLI version** — do not claim visual correctness,
  only structural. Tell the user to look at the live pane.

## Reviewable drafts (not yet in this version)

The automation layer beneath this CLI implements reviewable draft sessions
(`discard`, journal bounds, TTL); CLI verbs for them are not exposed yet.
Until they are: prefer small, reversible batches and tell the user before
large structural changes. Do not simulate drafts with ad-hoc file editing.

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
