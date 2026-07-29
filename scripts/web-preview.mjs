#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const command = process.argv[2] ?? "";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(root, "apps", "web", "dist");
const apiBaseUrl = process.env.DENTLINK_PREVIEW_API_BASE_URL?.replace(/\/$/, "");
const pagesProject = process.env.DENTLINK_PREVIEW_PAGES_PROJECT;
const pagesBranch = process.env.DENTLINK_PREVIEW_PAGES_BRANCH ?? "main";

if (!["build", "verify", "deploy"].includes(command)) {
  fail("Usage: node scripts/web-preview.mjs <build|verify|deploy>");
}

if (!apiBaseUrl) {
  fail("DENTLINK_PREVIEW_API_BASE_URL is required for preview web builds.");
}

if (apiBaseUrl !== "https://dentlink-api-preview.evanjrizzo.workers.dev") {
  fail(`Unexpected preview API base URL: ${apiBaseUrl}`);
}

if (!pagesProject) {
  fail("DENTLINK_PREVIEW_PAGES_PROJECT is required for preview web deployment.");
}

if (pagesProject !== "dentlink-web-preview") {
  fail(`Unexpected preview Pages project: ${pagesProject}`);
}

if (command === "build" || command === "deploy") {
  await freshPreviewBuild();
}

await verifyPreviewBundle();

if (command === "deploy") {
  run("pnpm", [
    "exec",
    "wrangler",
    "pages",
    "deploy",
    "apps/web/dist",
    "--project-name",
    pagesProject,
    "--branch",
    pagesBranch
  ]);
}

async function freshPreviewBuild() {
  await rm(distDir, { recursive: true, force: true });
  run("pnpm", ["--filter", "@dentlink/web", "build"], {
    ...process.env,
    VITE_DENTLINK_API_BASE_URL: apiBaseUrl
  });
}

async function verifyPreviewBundle() {
  const files = await listFiles(distDir);
  const browserFiles = files.filter((file) => /\.(html|js|css)$/.test(file));
  if (browserFiles.length === 0) {
    fail("Preview web build verification failed: apps/web/dist has no browser bundle files.");
  }

  const contents = await Promise.all(browserFiles.map((file) => readFile(file, "utf8")));
  const joined = contents.join("\n");
  if (!joined.includes(apiBaseUrl)) {
    fail(`Preview web build verification failed: browser bundle does not contain ${apiBaseUrl}.`);
  }

  const forbiddenOrigins = [
    "https://dentlink-web-preview.pages.dev/v1",
    "https://496cc3f7.dentlink-web-preview.pages.dev/v1",
    "https://c113e0f9.dentlink-web-preview.pages.dev/v1"
  ];
  const forbidden = forbiddenOrigins.find((origin) => joined.includes(origin));
  if (forbidden) {
    fail(
      `Preview web build verification failed: browser bundle contains Pages API origin ${forbidden}.`
    );
  }

  console.log(
    `Preview web bundle verified: ${relative(root, distDir)} targets ${apiBaseUrl} for project ${pagesProject}.`
  );
}

async function listFiles(directory) {
  const entries = await readdir(directory).catch((error) => {
    fail(`Preview web build verification failed: cannot read ${directory}: ${error.message}`);
  });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry);
    const info = await stat(path);
    if (info.isDirectory()) {
      files.push(...(await listFiles(path)));
    } else {
      files.push(path);
    }
  }
  return files;
}

function run(executable, args, env = process.env) {
  const result = spawnSync(executable, args, {
    cwd: root,
    env,
    stdio: "inherit"
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
