# elftia-plugin-rocut

The rocut skill plugin for Elftia — the S07 TinyElf-facing bundle in the
director-studio shape. Drives the rocut agent-first video editor (T3 topology:
external local backend + Web Pane) through its CLI.

Status: **0.2.0 dogfood stage** — the skill drives a local rocut source
checkout (bun required); no bundled build yet. Capabilities exposed: `host
start` → authenticated editorUrl → WebPane, `target list`, `read`/`apply`
transaction batches with revision/idempotency semantics, structural
verification. Draft verbs (begin/stage/approve/reject/discard with the reason
vocabulary) are exposed as of rocut PR #10; composed-frame visual
verification remains an honest gap.

Layout mirrors `elftia-plugin-director`:

- `elftia-plugin.json` — agent-kind plugin manifest with one skill
  contribution (`rocut-studio`, global audience)
- `skills/rocut-studio/SKILL.md` — the operating manual (session flow, batch
  discipline, verification, session-lifetime honesty, hard rules)

Upstream: rocut (OpenCut-derived SDK) — `https://github.com/DumoeDss/rocut`.
