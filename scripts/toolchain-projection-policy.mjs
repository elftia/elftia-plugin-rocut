import { FORBIDDEN_PLUGIN_TREE_SEGMENTS } from "@elftia/plugin-kit";

export const PROJECTION_POLICY = "runtime-without-types-source-maps-ci-vcs-v2";
export const CI_VCS_SEGMENTS = Object.freeze(FORBIDDEN_PLUGIN_TREE_SEGMENTS.filter(p => p === ".git" || p === ".github"));
export const isNonRuntimeToolchainFile = p => /(?:\.d\.(?:ts|mts|cts)|\.(?:js|mjs|cjs|ts|mts|cts|css)\.map)$/i.test(p);
export const isCiVcsToolchainFile = p => p.split("/").some(segment => CI_VCS_SEGMENTS.includes(segment.toLowerCase()));
export function isProjectedRemoval(p, policy) {
  return isNonRuntimeToolchainFile(p) || (policy === PROJECTION_POLICY && isCiVcsToolchainFile(p));
}
