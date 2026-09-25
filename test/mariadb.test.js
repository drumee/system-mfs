"use strict";

const assert = require("assert/strict");
const child_process = require("child_process");
const crypto = require("crypto");
const test = require("node:test");
const { MfsNamespace, SqlMfsStore, install, provision, validateInstallation, validateProvisioning } = require("../lib");

function docker(args, options = {}) {
  return child_process.spawnSync("docker", args, { encoding: "utf8", ...options });
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}

function bind(sql, parameters) {
  let index = 0;
  const bound = sql.replace(/\?/g, () => sqlLiteral(parameters[index++]));
  if (index !== parameters.length) throw new Error("SQL parameter count does not match placeholders");
  return bound;
}

function parse(output) {
  const lines = output.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t");
  return lines.slice(1).filter((line) => line.split("\t").length === headers.length).map((line) => Object.fromEntries(
    line.split("\t").map((value, index) => [headers[index], value === "NULL" ? null : value])
  ));
}

test("standalone lifecycle executes against disposable MariaDB", { timeout: 180000 }, async (t) => {
  if (docker(["info"]).status !== 0) {
    t.skip("Docker is unavailable");
    return;
  }

  const suffix = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  const container = `system-mfs-test-${suffix}`;
  t.after(() => docker(["rm", "-f", container]));
  const started = docker([
    "run", "-d", "--name", container,
    "-e", "MARIADB_DATABASE=yp",
    "-e", "MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1",
    "mariadb:11.4"
  ]);
  assert.equal(started.status, 0, started.stderr);

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const ping = docker(["exec", container, "mariadb", "-uroot", "yp", "--execute", "SELECT 1"]);
    if (ping.status === 0) { ready = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(ready, true, docker(["logs", container]).stdout);

  const database = {
    async query(sql, ...parameters) {
      const result = docker([
        "exec", container,
        "mariadb", "-uroot", "--batch", "--raw", "yp", "--execute", bind(sql, parameters)
      ]);
      if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`.trim());
      return parse(result.stdout);
    },
    async executeScript(script, { database: selected = "yp" } = {}) {
      const result = docker([
        "exec", "-i", container,
        "mariadb", "-uroot", "--batch", "--raw", selected
      ], { input: script });
      if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`.trim());
    }
  };

  await database.query("CREATE FUNCTION uniqueId() RETURNS VARCHAR(16) NOT DETERMINISTIC RETURN SUBSTRING(MD5(RAND()),1,16)");
  await database.query("CREATE TABLE entity (id VARCHAR(16) PRIMARY KEY, dom_id INT, db_name VARCHAR(255), home_dir VARCHAR(255), home_id VARCHAR(16))");
  await database.query("CREATE TABLE drumate (id VARCHAR(16) PRIMARY KEY, domain_id INT NOT NULL)");
  await database.query("CREATE TABLE organisation (sys_id INT PRIMARY KEY, domain_id INT NOT NULL)");
  await database.query("INSERT INTO organisation (sys_id,domain_id) VALUES (1,1)");
  await database.query("INSERT INTO entity (id,dom_id,db_name,home_dir,home_id) VALUES ('a000000000000001',1,'identity_a000000000000001','/platform-identities/a000000000000001',NULL)");
  await database.query("INSERT INTO drumate (id,domain_id) VALUES ('a000000000000001',1)");

  const store = new SqlMfsStore({ database });
  const context = { organisation_id: 1, principal_id: "a000000000000001" };
  assert.equal((await validateInstallation({ store })).status, "not-installed");
  assert.equal((await install({ store })).changed, true);
  assert.equal((await install({ store })).changed, false);
  assert.equal((await validateProvisioning({ store, context })).status, "installed");
  const first = await provision({ store, context });
  assert.equal(first.status, "provisioned");
  assert.equal((await provision({ store, context })).changed, false);

  const mfs = new MfsNamespace({ store, context });
  const created = await mfs.makeDirectory(first.root_id, "Documents");
  assert.equal((await mfs.resolveNode(created.nid)).nid, created.nid);
  assert.deepEqual((await mfs.listChildren(first.root_id)).map((node) => node.nid), [created.nid]);
});
