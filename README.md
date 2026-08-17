# elftia-plugin-rocut

The rocut skill plugin for Elftia — the S07 TinyElf-facing bundle in the
director-studio shape. Drives the rocut agent-first video editor (T3 topology:
external local backend + Web Pane) through its CLI.

Status: **0.1.0 dogfood stage** — the skill drives a local rocut source
checkout (bun required); no bundled build yet. Capabilities exposed: `host
start` → authenticated editorUrl → WebPane, `target list`, `read`/`apply`
transaction batches with revision/idempotency semantics, structural
verification. Draft verbs and composed-frame visual verification are
documented as not-yet-available (honest gaps, see the skill).

Layout mirrors `elftia-plugin-director`:

- `elftia-plugin.json` — agent-kind plugin manifest with one skill
  contribution (`rocut-studio`, global audience)
- `skills/rocut-studio/SKILL.md` — the operating manual (session flow, batch
  discipline, verification, session-lifetime honesty, hard rules)

Upstream: rocut (OpenCut-derived SDK) — `https://github.com/DumoeDss/rocut`.
