"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function sqlFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? sqlFiles(absolute) : entry.name.endsWith(".sql") ? [absolute] : [];
  });
}

test("every system-mfs SQL source defines exactly one schema object", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "server/schemas/SCHEMA_MANIFEST.json")));
  const entries = manifest.install.concat(manifest.provision);
  const files = sqlFiles(path.join(root, "schemas"));
  assert.equal(files.length, entries.length, "every SQL file must be represented once in the manifest");
  for (const filename of files) {
    const relative = path.relative(root, filename).split(path.sep).join("/");
    const source = fs.readFileSync(filename, "utf8");
    const creates = [...source.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?(PROCEDURE|FUNCTION|TABLE|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-z0-9_]+)`?/gi)];
    assert.equal(creates.length, 1, `${relative} must contain exactly one top-level CREATE object`);
    const entry = entries.find((value) => value.path === relative);
    assert.ok(entry, `${relative} is absent from the manifest`);
    assert.equal(creates[0][1].toLowerCase(), entry.objectType);
    assert.equal(creates[0][2].toLowerCase(), entry.objectName.toLowerCase());
  }
  assert.equal(new Set(entries.map((entry) => entry.path)).size, entries.length, "manifest paths must be unique");
});
