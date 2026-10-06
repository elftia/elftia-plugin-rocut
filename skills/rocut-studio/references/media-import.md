# Local media ingestion

Use the bundled `CLI` and explicit `TARGET` established by `SKILL.md`.

```bash
node "$CLI" capabilities --target "$TARGET"
node "$CLI" read --target "$TARGET"
node "$CLI" media import import.json --target "$TARGET"
node "$CLI" read --target "$TARGET"
```

Require `capabilities.mediaImport.route` to equal `media/import`. An old runtime
without it needs updating; do not emulate ingestion with `create-asset` or native
record writes. `create-asset` has no path field and does not copy a file.

`import.json` for a local song or rendered video:

```json
{
  "filePath": "E:/my-mv/assets/song.wav",
  "expectedRevision": 0,
  "idempotencyKey": "mv-song-v1"
}
```

Replace the path with an authorized, existing **absolute local file path**, and
revision with the current read value. No remote URL download is performed.
The host probes audio/video container metadata with the editor's media I/O
library, saves original bytes as a project attachment, then creates the asset
through the revision-checked transaction engine. No pane or model is required.
One import is limited to 512 MiB; unsupported/corrupt containers fail. Probe
success is not proof that a particular pane can decode that codec.

Images need an additional `image` object with dimensions established by the
generation result or an authorized image-inspection tool, not guessed values:

```json
{
  "filePath": "E:/my-mv/assets/character.png",
  "expectedRevision": 1,
  "idempotencyKey": "mv-character-v1",
  "image": { "mimeType": "image/png", "width": 1024, "height": 1536 }
}
```

Accepted MIME declarations: PNG, JPEG, WebP, GIF, AVIF. This route does not decode
images or certify their dimensions, alpha channel, orientation or animation;
the response explicitly marks `metadataSource: "caller"`. For static cutouts,
prefer an inspected transparent PNG. SVG and numbered image sequences are not
direct import inputs here. Audio/video uses `metadataSource: "container"`.

The response contains `asset` (real ID, kind and available dimensions/duration),
`sourceSha256`, `result` (transaction receipt) and `replayed`. Asset durations are
**ticks**, while the attachment's internal metadata uses seconds. Use the public
asset response and `read`, not attachment internals, to author clips.

Import does not insert a clip or change project fps. Create a compatible track
and `create-clip` referencing the returned `asset.id`; set `startTime`, `duration`,
`trimStart`, `trimEnd` in ticks and align timeline boundaries to project frames.
An image belongs on a video track, a song on audio. Preserve all scene IDs and
do not exceed an audio/video source's duration. Bind motion text to the actual
song clip through its high-level mutation if needed.

Retries with the same key and identical bytes/name/metadata replay across Host
restarts; changing the imported content under that key conflicts. The source
must remain readable for a retry. When a result is uncertain, read first; do not
blindly allocate a fresh key. A replay is an old receipt, not a request to restore
a subsequently deleted asset. Missing/changed saved attachments refuse replay.

Bytes are prepared before the atomic asset transaction. A crash or failed project
save can leave an uncommitted attachment; keep the source/spec and retry the same
request. Do not manually delete project attachments or claim transfer and record
save form a multi-file atomic transaction. Successful imports survive source-file
relocation because the project owns a copy. Check actual playback/export separately.
