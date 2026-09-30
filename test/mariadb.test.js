"use strict";

const assert = require("node:assert/strict");
const child_process = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { LocalContentStore, MfsFilesystem, SqlMfsStore, install, provision, validateProvisioning } = require("../lib");

function docker(args, options = {}) { return child_process.spawnSync("docker", args, { encoding: "utf8", ...options }); }
function sqlLiteral(value) { if (value === null || value === undefined) return "NULL"; if (typeof value === "number") return String(value); return `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "''")}'`; }
function bind(sql, parameters) { let index = 0; const bound = sql.replace(/\?/g, () => sqlLiteral(parameters[index++])); if (index !== parameters.length) throw new Error("SQL parameter count does not match placeholders"); return bound; }
function parse(output) { const lines = output.trim().split("\n").filter(Boolean); if (lines.length < 2) return []; const headers = lines[0].split("\t"); return lines.slice(1).filter((line) => line.split("\t").length === headers.length).map((line) => Object.fromEntries(line.split("\t").map((value, index) => [headers[index], value === "NULL" ? null : value]))); }

test("resolved hub/drumate shards execute the procedure-backed MFS closure", { timeout: 180000 }, async (t) => {
  if (docker(["info"]).status !== 0) { t.skip("Docker is unavailable"); return; }
  const suffix = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  const container = `system-mfs-test-${suffix}`;
  t.after(() => docker(["rm", "-f", container]));
  const started = docker(["run", "-d", "--name", container, "-e", "MARIADB_DATABASE=yp", "-e", "MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1", "mariadb:11.4"]);
  assert.equal(started.status, 0, started.stderr);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) { if (docker(["exec", container, "mariadb", "-uroot", "yp", "--execute", "SELECT 1"]).status === 0) { ready = true; break; } await new Promise((resolve) => setTimeout(resolve, 500)); }
  assert.equal(ready, true, docker(["logs", container]).stdout);

  const database = {
    async query(sql, ...parameters) { const result = docker(["exec", container, "mariadb", "-uroot", "--batch", "--raw", "yp", "--execute", bind(sql, parameters)]); if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`.trim()); return parse(result.stdout); },
    async executeScript(script, { database: selected = "yp" } = {}) { const result = docker(["exec", "-i", container, "mariadb", "-uroot", "--batch", "--raw", selected], { input: script }); if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`.trim()); }
  };

  const hub_id = "a000000000000001";
  const user_id = "b000000000000002";
  const other_uid = "c000000000000003";
  await database.query("CREATE FUNCTION uniqueId() RETURNS VARCHAR(16) NOT DETERMINISTIC RETURN SUBSTRING(MD5(RAND()),1,16)");
  await database.query("CREATE TABLE entity (id VARCHAR(16) PRIMARY KEY,db_name VARCHAR(64),db_host VARCHAR(64),fs_host VARCHAR(64),home_dir VARCHAR(255),home_id VARCHAR(16),type VARCHAR(16))");
  await database.query("CREATE TABLE hub (id VARCHAR(16) PRIMARY KEY,owner_id VARCHAR(16))");
  await database.query("CREATE TABLE drumate (id VARCHAR(16) PRIMARY KEY)");
  await database.query("CREATE TABLE vhost (id VARCHAR(16),fqdn VARCHAR(255))");
  await database.query("CREATE DATABASE shard_hub_a");
  await database.query("CREATE DATABASE shard_user_b");
  await database.query("INSERT INTO entity VALUES (?,?,?,?,?,?,?)", hub_id, "shard_hub_a", "db.internal", "fs.internal", "/srv/hub-a", null, "hub");
  await database.query("INSERT INTO entity VALUES (?,?,?,?,?,?,?)", user_id, "shard_user_b", "db.internal", "fs.internal", "/srv/user-b", null, "drumate");
  await database.query("INSERT INTO hub VALUES (?,?)", hub_id, user_id);
  await database.query("INSERT INTO drumate VALUES (?)", user_id);
  await database.query("INSERT INTO vhost VALUES (?,?)", hub_id, "hub.example.test");

  const store = new SqlMfsStore({ database });
  await install({ store });
  const hub = await provision({ store, context: { hub_id } });
  const user = await provision({ store, context: { hub_id: user_id } });
  assert.equal((await provision({ store, context: { host: "hub.example.test" } })).changed, false);
  assert.equal((await validateProvisioning({ store, context: { hub_id } })).valid, true);
  assert.equal(Object.hasOwn(hub, "database_name"), false);
  assert.equal(user.type, "drumate");
  assert.equal((await database.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'mfs\\_%'")).length, 0);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "system-mfs-content-"));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const staged = path.join(work, "staged.txt");
  fs.writeFileSync(staged, "phase 4.8");
  const content_store = new LocalContentStore({ root: path.join(work, "canonical"), staging: { claim(ref) { assert.equal(ref.token, "stage-1"); return staged; } } });
  const filesystem = new MfsFilesystem({ store, principal: user_id, content_store });
  const hub_root = { hub_id, nid: hub.root_id };
  const user_root = { hub_id: user_id, nid: user.root_id };
  const docs = await filesystem.makeDirectory({ destination: hub_root, name: "Documents" });
  const archive = await filesystem.makeDirectory({ destination: hub_root, name: "Archive" });
  assert.equal((await filesystem.listChildren({ location: hub_root, limit: 1 })).items.length, 1);
  assert.equal((await filesystem.renameNode({ node: { hub_id, nid: docs.nid }, name: "Docs" })).filename, "Docs");
  await filesystem.moveNodes({ nodes: [{ hub_id, nid: docs.nid }], destination: { hub_id, nid: archive.nid } });
  assert.equal((await filesystem.getNode({ node: { hub_id, nid: docs.nid } })).parent_id, archive.nid);
  const committed = await filesystem.commitFile({ destination: hub_root, payload_ref: { token: "stage-1" }, metadata: { filename: "payload.txt", extension: "txt", mimetype: "text/plain", filetype: "text", size: 9 } });
  assert.equal((await content_store.read(committed.storage_ref)).toString(), "phase 4.8");
  const copied = await filesystem.copyTree({ sources: [{ hub_id, nid: committed.nid }], destination: user_root });
  assert.equal(copied.nodes[0].node.hub_id, user_id);
  assert.ok((await filesystem.enumerateTree({ roots: [user_root] })).entries.some((entry) => entry.filename === "payload"));

  await database.query("INSERT INTO shard_hub_a.permission (resource_id,entity_id,message,expiry_time,ctime,utime,permission,assign_via) VALUES (?,?,NULL,0,0,0,4,'share')", archive.nid, other_uid);
  await database.query("INSERT INTO shard_hub_a.permission (resource_id,entity_id,message,expiry_time,ctime,utime,permission,assign_via) VALUES (?,?,NULL,0,0,0,1,'no_traversal')", docs.nid, "*");
  assert.equal(await store.effectivePermission(other_uid, { hub_id, nid: docs.nid }), 1, "explicit node wildcard wins before inherited parent");
  await database.query("DELETE FROM shard_hub_a.permission WHERE resource_id=? AND entity_id='*'", docs.nid);
  assert.equal(await store.effectivePermission(other_uid, { hub_id, nid: docs.nid }), 4, "parent permission is inherited");
  assert.equal(await store.effectivePermission("ffffffffffffffff", { hub_id, nid: docs.nid }), 0, "nobody normalizes to wildcard and defaults to zero");
  await database.query("INSERT INTO shard_hub_a.permission (resource_id,entity_id,message,expiry_time,ctime,utime,permission,assign_via) VALUES (?,?,NULL,0,0,0,1,'share')", docs.nid, "*");
  assert.equal(await store.effectivePermission("nobody", { hub_id, nid: docs.nid }), 1);
  assert.equal((await filesystem.removeNode({ node: { hub_id, nid: archive.nid } })).hard_delete, true);
});
