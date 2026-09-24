"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const { MfsNamespace, capabilityAvailable, install, provision, validateInstallation, validateProvisioning } = require("../lib");

const context = { organisation_id: 1, principal_id: "a000000000000001" };
const version = "phase4.6b-system-mfs-1";

class MemoryStore {
  constructor() {
    this.installation = { tables: [], marker: null };
    this.identity = [{ id: context.principal_id, organisation_id: 1, db_name: `identity_${context.principal_id}`, home_dir: `/platform-identities/${context.principal_id}`, home_id: null }];
    this.snapshot = { database_name: `mfs_${context.principal_id}`, database_exists: false, state: null, tables: [], routines: [], roots: [], permissions: [] };
    this.nodes = [];
    this.mutations = 0;
    this.fail_create = false;
  }
  async inspectInstallation() { return structuredClone(this.installation); }
  async installSchemas() { this.mutations++; this.installation = { tables: ["system_mfs_installation", "system_mfs_provisioning"], marker: { singleton: 1, schema_version: version } }; }
  async inspectIdentity() { return structuredClone(this.identity); }
  async inspectContext() { return structuredClone(this.snapshot); }
  async beginProvisioning(target) {
    this.mutations++;
    this.snapshot.state = { organisation_id: 1, principal_id: context.principal_id, database_name: target.database_name, root_id: null, schema_version: version, status: "provisioning", error_code: null };
  }
  async createNamespace() {
    this.mutations++;
    this.snapshot.database_exists = true;
    if (this.fail_create) throw Object.assign(new Error("fixture failure"), { code: "FIXTURE_FAILURE" });
    this.snapshot.tables = ["media", "permission"];
    this.snapshot.routines = ["mfs_clean_path", "mfs_init_folders", "mfs_make_dir", "mfs_node_attr", "mfs_show_node_by"];
    this.snapshot.roots = [{ id: "b000000000000002", owner_id: context.principal_id, file_path: "/", parent_id: "0", category: "root" }];
    this.snapshot.permissions = [{ resource_id: "*", entity_id: context.principal_id, permission: 63, assign_via: "root" }];
    return "b000000000000002";
  }
  async finishProvisioning({ root_id }) { this.mutations++; Object.assign(this.snapshot.state, { root_id, status: "provisioned" }); }
  async failProvisioning(_target, code) { this.snapshot.state.status = "failed"; this.snapshot.state.error_code = code; }
  async makeDirectory(_target, parent_id, name) {
    const existing = this.nodes.find((node) => node.parent_id === parent_id && node.filename === name);
    if (existing) return structuredClone(existing);
    const node = { nid: "c000000000000003", parent_id, filename: name, filepath: `/${name}` };
    this.nodes.push(node);
    return structuredClone(node);
  }
  async resolveNode(_target, node) { return structuredClone(this.nodes.find((entry) => entry.nid === node || entry.filepath === node) || null); }
  async listChildren(_target, parent_id) { return structuredClone(this.nodes.filter((entry) => entry.parent_id === parent_id)); }
}

test("installation is explicit, repeatable and module-relative", async () => {
  const store = new MemoryStore();
  assert.equal((await validateInstallation({ store })).status, "not-installed");
  assert.equal((await install({ store })).changed, true);
  const mutations = store.mutations;
  assert.equal((await install({ store })).changed, false);
  assert.equal(store.mutations, mutations);
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../schemas/SCHEMA_MANIFEST.json")));
  assert.ok(manifest.install.concat(manifest.provision).every((entry) => !path.isAbsolute(entry.path) && !entry.path.includes("sources/") && !entry.path.includes("target/")));
});

test("an installed module does not imply that an identity placeholder is provisioned", async () => {
  const store = new MemoryStore();
  await install({ store });
  const report = await validateProvisioning({ store, context });
  assert.equal(report.status, "installed");
  assert.equal(report.available, false);
  assert.match(store.identity[0].db_name, /^identity_/);
  assert.match(store.identity[0].home_dir, /^\/platform-identities\//);
});

test("provisioning is explicit and idempotent with stable resource identifiers", async () => {
  const store = new MemoryStore();
  await install({ store });
  const first = await provision({ store, context });
  const mutations = store.mutations;
  const second = await provision({ store, context });
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(second.root_id, first.root_id);
  assert.equal(store.mutations, mutations);
  assert.deepEqual(await capabilityAvailable({ store, context }), { available: true, status: "provisioned" });
});

test("validation is read-only and partial state is detected", async () => {
  const store = new MemoryStore();
  await install({ store });
  store.snapshot.database_exists = true;
  store.snapshot.tables = ["media"];
  const before = structuredClone(store);
  const report = await validateProvisioning({ store, context });
  assert.equal(report.status, "partial");
  assert.match(report.missing.join(" "), /provisioning-state|table:permission/);
  assert.deepEqual(store.snapshot, before.snapshot);
  await assert.rejects(() => provision({ store, context }), (error) => error.code === "MFS_PROVISIONING_PARTIAL");
});

test("conflicting state fails deterministically", async () => {
  const store = new MemoryStore();
  await install({ store });
  await provision({ store, context });
  store.snapshot.state.database_name = "mfs_wrong";
  const report = await validateProvisioning({ store, context });
  assert.equal(report.status, "conflicting");
  await assert.rejects(() => provision({ store, context }), (error) => error.code === "MFS_PROVISIONING_CONFLICT");
});

test("failed provisioning never reports the capability as available", async () => {
  const store = new MemoryStore();
  await install({ store });
  store.fail_create = true;
  await assert.rejects(() => provision({ store, context }), /fixture failure/);
  assert.equal(store.snapshot.state.status, "failed");
  assert.equal((await capabilityAvailable({ store, context })).available, false);
});

test("the historical root, create, resolve and list path is exercised through the namespace", async () => {
  const store = new MemoryStore();
  await install({ store });
  const ready = await provision({ store, context });
  const mfs = new MfsNamespace({ store, context });
  const created = await mfs.makeDirectory(ready.root_id, "Documents");
  const repeated = await mfs.makeDirectory(ready.root_id, "Documents");
  assert.equal(repeated.nid, created.nid);
  assert.equal((await mfs.resolveNode("/Documents")).nid, created.nid);
  assert.deepEqual((await mfs.listChildren(ready.root_id)).map((node) => node.nid), [created.nid]);
});
