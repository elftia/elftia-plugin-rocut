import assert from "node:assert/strict";

export const COMPILER_PROFILE = "rocut-three-engine-compiler-v1";
export const OMITTED_PACKAGES = Object.freeze({
  "node_modules/@chenglou/pretext": "0.0.5",
  "node_modules/@hyperframes/studio-server": "0.8.139",
  "node_modules/@img/colour": "1.1.0",
  "node_modules/@img/sharp-win32-x64": "0.35.5",
  "node_modules/argparse": "2.0.1",
  "node_modules/bpm-detective": "2.0.5",
  "node_modules/detect-libc": "2.1.2",
  "node_modules/hono": "4.13.13",
  "node_modules/semver": "7.8.5",
  "node_modules/sharp": "0.35.5",
  "node_modules/wawoff2": "2.0.1",
});
const OMITTED_CORE_DEPENDENCIES = new Set(["@chenglou/pretext", "@hyperframes/studio-server", "bpm-detective", "wawoff2"]);
export const PROFILE_ENTRY_POINTS = Object.freeze([
  "node_modules/@hyperframes/core/dist/compiler/index.js",
  "node_modules/@hyperframes/core/dist/compiler/htmlDocument.js",
  "node_modules/@hyperframes/core/dist/compiler/mediaRenderIds.js",
  "node_modules/@hyperframes/core/dist/generated/audio-fx-runtime-inline.js",
]);
export function assertCompilerProfile(profile) {
  assert.equal(profile, COMPILER_PROFILE, "unknown toolchain compiler consumer profile");
}
export function isCompilerOmission(relative, version) {
  return Object.hasOwn(OMITTED_PACKAGES, relative) && OMITTED_PACKAGES[relative] === version;
}
export function maySkipCompilerDependency(owner, name, relative, version) {
  return owner === "node_modules/@hyperframes/core" && OMITTED_CORE_DEPENDENCIES.has(name) && isCompilerOmission(relative, version);
}
export const ownsFile = (pkg, file) => file.startsWith(pkg + "/") && !file.slice(pkg.length + 1).includes("node_modules/");
