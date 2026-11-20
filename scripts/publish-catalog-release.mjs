import assert from "node:assert/strict";

const { GITHUB_REPOSITORY: repository, GH_TOKEN: githubToken, RELEASE_TAG: tag,
  ELFTIA_PUBLISHER_TOKEN: publisherToken } = process.env;
const match = /^elftia\/elftia-plugin-([a-z0-9-]+)$/.exec(repository ?? "");
assert(match && /^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag ?? "") && githubToken && publisherToken,
  "Expected an official plugin repository, version tag and publisher credentials");
const slug = match[1];
const api = `https://api.github.com/repos/${repository}`;
const headers = { Authorization: `Bearer ${githubToken}`, "User-Agent": "Elftia-official-plugin-release" };
const metadata = await fetch(`${api}/releases/tags/${tag}`, { headers, redirect: "error" });
assert(metadata.ok, `Release lookup returned HTTP ${metadata.status}`);
const release = await metadata.json();
assert(!release.draft && !release.prerelease && release.tag_name === tag, "Expected a published stable release");
const asset = release.assets.find(a => a.name === `${slug}.epkg`);
assert(asset?.state === "uploaded" && /^sha256:[a-f0-9]{64}$/.test(asset.digest), "Missing verified EPKG asset");
const download = await fetch(`${api}/releases/assets/${asset.id}?download=${Date.now()}`, {
  headers: { ...headers, Accept: "application/octet-stream" }, redirect: "manual",
});
let location = download.headers.get("location");
await download.body?.cancel();
if (!location) {
  const publicDownload = await fetch(`https://github.com/${repository}/releases/download/${tag}/${slug}.epkg`, { redirect: "manual" });
  location = publicDownload.headers.get("location");
  await publicDownload.body?.cancel();
}
assert(location && new URL(location).origin === "https://release-assets.githubusercontent.com",
  "GitHub did not issue a release-asset download URL");
const sha256 = asset.digest.slice(7);
const response = await fetch("https://api.elftia.com/api/v1/marketplace/plugin/publish/official-release", {
  method: "POST", redirect: "error",
  headers: { Authorization: `Bearer ${publisherToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ url: location, size: asset.size, slug, version: tag.slice(1), sha256 }),
});
const result = await response.json().catch(() => ({}));
assert(response.ok, `Official catalog returned HTTP ${response.status}: ${String(result.detail ?? "").slice(0, 120)}`);
assert(result.moderation_status === "approved" && result.sha256 === sha256 &&
  result.slug === slug && result.version === tag.slice(1), "Catalog receipt differs from the GitHub asset");
console.log(`Published ${slug} ${tag}: ${asset.size} bytes, SHA-256 ${sha256}`);
