"use strict";

const assert = require("assert/strict");
const child_process = require("child_process");
const fs = require("fs");
const { isBuiltin } = require("module");
const os = require("os");
const path = require("path");
const test = require("node:test");

const package_root = path.resolve(__dirname, "..");

function run(command, args, options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  delete env.NODE_TEST_CONTEXT;
  return child_process.spawnSync(command, args, {
    cwd: options.cwd || package_root,
    encoding: "utf8",
    env
  });
}

function mustRun(command, args, options = {}) {
  const result = run(command, args, options);
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result;
}

test("packed system-mfs is standalone, confined and dependency-complete", { timeout: 300000 }, (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "system-mfs-artifact-"));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const artifacts = path.join(work, "artifacts");
  const consumer = path.join(work, "consumer");
  const cache = process.env.NPM_CONFIG_CACHE || path.join(work, "npm-cache");
  fs.mkdirSync(artifacts, { recursive: true });
  fs.mkdirSync(consumer, { recursive: true });

  mustRun("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", artifacts], {
    env: { NPM_CONFIG_CACHE: cache }
  });
  const archives = fs.readdirSync(artifacts).filter((name) => name.endsWith(".tgz"));
  assert.equal(archives.length, 1);
  const artifact = path.join(artifacts, archives[0]);
  const entries = mustRun("tar", ["-tzf", artifact]).stdout.trim().split("\n").filter(Boolean);
  for (const expected of [
    "package/lib/index.js",
    "package/lib/store.js",
    "package/schemas/SCHEMA_MANIFEST.json",
    "package/schemas/yellow-page/001-capability-state.sql",
    "package/schemas/context/001-mfs-core.sql",
    "package/README.md",
    "package/PROVENANCE.md"
  ]) assert.ok(entries.includes(expected), `artifact omits ${expected}`);
  for (const entry of entries) {
    assert.doesNotMatch(entry, /^package\/(?:node_modules|sources|target|tests?|\.tmp|\.github)\//);
  }

  fs.writeFileSync(path.join(consumer, "package.json"), JSON.stringify({ name: "system-mfs-consumer", private: true }));
  mustRun("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", artifact], {
    cwd: consumer,
    env: { NPM_CONFIG_CACHE: cache, NODE_PATH: "" }
  });
  const installed_root = path.join(consumer, "node_modules", "@drumee", "system-mfs");
  const installed_package = JSON.parse(fs.readFileSync(path.join(installed_root, "package.json"), "utf8"));
  const manifest = JSON.parse(fs.readFileSync(path.join(installed_root, "schemas", "SCHEMA_MANIFEST.json"), "utf8"));
  assert.equal(installed_package.name, "@drumee/system-mfs");
  assert.equal(installed_package.version, "0.1.0-alpha.1");
  assert.equal(manifest.owner, installed_package.name);
  assert.equal(manifest.packageVersion, installed_package.version);
  for (const section of ["install", "provision"]) {
    for (const entry of manifest[section]) {
      assert.equal(path.isAbsolute(entry.path), false);
      assert.equal(entry.path.split(/[\\/]+/).includes(".."), false);
      assert.ok(fs.statSync(path.join(installed_root, entry.path)).isFile());
    }
  }

  const external = new Set();
  for (const entry of entries.filter((name) => /^package\/lib\/.*\.js$/.test(name))) {
    const relative = entry.slice("package/".length);
    const source = fs.readFileSync(path.join(installed_root, relative), "utf8");
    assert.doesNotMatch(source, /(?:process\.cwd\(|NODE_PATH|\/opt\/kernel|\/home\/|sources\/|target\/)/, `hidden coupling in ${relative}`);
    for (const match of source.matchAll(/require\((['"])([^'"]+)\1\)/g)) {
      const specifier = match[2];
      if (specifier.startsWith(".")) continue;
      assert.equal(path.isAbsolute(specifier), false);
      if (!isBuiltin(specifier)) external.add(specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/", 1)[0]);
    }
  }
  assert.deepEqual([...external], []);

  const smoke = `
    const assert = require("assert/strict");
    const api = require("@drumee/system-mfs");
    for (const name of ["MfsError", "MfsNamespace", "SqlMfsStore", "install", "provision", "validateInstallation", "validateProvisioning", "capabilityAvailable"]) {
      assert.equal(typeof api[name], "function", name);
    }
  `;
  mustRun("node", ["-e", smoke], { cwd: consumer, env: { NODE_PATH: "" } });
  t.diagnostic(`artifact=${archives[0]}`);
  t.diagnostic(`files=${entries.join(",")}`);
  t.diagnostic("external dependencies=none");
});
