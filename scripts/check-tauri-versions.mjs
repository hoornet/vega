#!/usr/bin/env node
// Fail when a Tauri Rust crate and its npm package disagree on major.minor.
//
// Why this exists: `tauri build` refuses to run across such a mismatch
// ("Found version mismatched Tauri packages"), but test.yml never invokes the
// Tauri CLI, so a mismatch passes CI and only surfaces in release.yml — i.e. as
// a failed release on every platform — and immediately for anyone building
// main HEAD (the vega-nostr-git AUR package). It happened on 2026-09-27, when
// Dependabot's cargo and npm "tauri group" PRs landed tauri-plugin-http 2.7.0
// against @tauri-apps/plugin-http 2.6.1.
//
// Why not `tauri info`: it prints the same error but exits 0, and grepping its
// wording would pass silently the day the CLI rephrases it. This reads the two
// lockfiles, which is what the CLI compares, and needs no install or compile.
//
// Pairs checked: `tauri` <-> `@tauri-apps/api`, and every
// `tauri-plugin-<x>` <-> `@tauri-apps/plugin-<x>` present in both lockfiles.
// Rust-only plugins (no npm package) are skipped.
//
// Usage: node scripts/check-tauri-versions.mjs      Exit: 0 ok, 1 mismatch/error

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Cargo.lock: collect every version of each `tauri` / `tauri-plugin-*` crate.
const cargoLock = readFileSync(join(root, "src-tauri/Cargo.lock"), "utf8");
const crates = new Map();
for (const block of cargoLock.split("[[package]]")) {
  const name = block.match(/^name = "([^"]+)"$/m)?.[1];
  const version = block.match(/^version = "([^"]+)"$/m)?.[1];
  if (!name || !version) continue;
  if (name !== "tauri" && !name.startsWith("tauri-plugin-")) continue;
  if (!crates.has(name)) crates.set(name, new Set());
  crates.get(name).add(version);
}

// package-lock.json: the installed version of each @tauri-apps package.
const npmLock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const npmVersion = (pkg) => npmLock.packages?.[`node_modules/${pkg}`]?.version;

const pairs = [];
for (const [crate, versions] of crates) {
  const pkg = crate === "tauri" ? "@tauri-apps/api" : `@tauri-apps/${crate.slice("tauri-".length)}`;
  const js = npmVersion(pkg);
  if (!js) continue; // Rust-only plugin
  for (const rs of versions) pairs.push({ crate, rs, pkg, js });
}

const majorMinor = (v) => v.split(".").slice(0, 2).join(".");

// A check that finds nothing to compare must not pass: that would mean the
// lockfile format changed under us and the gate went permanently green.
if (!pairs.some((p) => p.crate === "tauri")) {
  console.error("check-tauri-versions: could not find the tauri <-> @tauri-apps/api pair in the lockfiles.");
  process.exit(1);
}

let bad = 0;
for (const { crate, rs, pkg, js } of pairs) {
  const ok = majorMinor(rs) === majorMinor(js);
  if (!ok) bad++;
  console.log(`${ok ? "ok      " : "MISMATCH"}  ${crate} ${rs}  <->  ${pkg} ${js}`);
}

if (bad) {
  console.error(
    `\n${bad} mismatched pair(s). \`tauri build\` will refuse to run, so the release would fail on every platform.\n` +
      "Move the Rust crate and the npm package to the same major.minor — note a plugin bump can pull\n" +
      "@tauri-apps/api up a minor through its own dependency, which then has to match the `tauri` crate.",
  );
  process.exit(1);
}
console.log(`\nAll ${pairs.length} Tauri Rust/npm pairs agree on major.minor.`);
