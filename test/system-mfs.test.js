"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { capabilityAvailable, install, provision, validateInstallation, validateProvisioning } = require("../lib");
const { schemaEntries } = require("../lib/store");

const version = "phase4.8-system-mfs-2";
const hub = { hub_id: "a000000000000001", db_name: "shard_hub_a", type: "hub", owner_id: "c000000000000003", home_dir: "/internal/hub" };
const drumate = { hub_id: "b000000000000002", db_name: "shard_user_b", type: "drumate", owner_id: "b000000000000002", home_dir: "/internal/user" };

class MemoryStore {
  constructor() {
    this.installation = { tables: [], marker: null };
    this.descriptors = new Map([[hub.hub_id, hub], [drumate.hub_id, drumate], ["hub.example.test", hub]]);
    this.snapshots = new Map();
    this.mutations = 0;
    this.applied = [];
  }
  resolveShard({ hub_id, host }) { const value = this.descriptors.get(hub_id || host); if (!value) throw new Error("missing shard"); return structuredClone(value); }
  inspectInstallation() { return structuredClone(this.installation); }
  installSchemas() { this.mutations++; this.installation = { tables: ["system_mfs_installation", "system_mfs_provisioning"], marker: { singleton: 1, schema_version: version } }; }
  async inspectContext(context) {
    const descriptor = await this.resolveShard(context);
    return structuredClone(this.snapshots.get(descriptor.hub_id) || { descriptor, database_exists: true, state: null, tables: [], routines: [], roots: [], permissions: [] });
  }
  beginProvisioning(descriptor) {
    this.mutations++;
    this.snapshots.set(descriptor.hub_id, { descriptor, database_exists: true, state: { hub_id: descriptor.hub_id, shard_type: descriptor.type, database_name: descriptor.db_name, root_id: null, schema_version: version, status: "provisioning" }, tables: [], routines: [], roots: [], permissions: [] });
  }
  createNamespace(descriptor) {
    this.mutations++;
    this.applied.push(...schemaEntries("provision", descriptor.type).map((entry) => `${descriptor.type}:${entry.order}:${entry.objectName}`));
    const snapshot = this.snapshots.get(descriptor.hub_id);
    snapshot.tables = ["media", "permission"];
    snapshot.routines = ["mfs_clean_path", "parent_permission", "user_permission", "user_expiry", "mfs_create_node", "mfs_node_attr", "mfs_make_dir", "mfs_init_folders", "mfs_show_node_by", "mfs_list_children", "mfs_rename", "mfs_hard_remove", "mfs_move_nodes", "mfs_enumerate_tree"];
    const root_id = descriptor.type === "hub" ? "d000000000000004" : "e000000000000005";
    snapshot.roots = [{ id: root_id, owner_id: descriptor.owner_id, file_path: "/", parent_id: "0", category: "root" }];
    snapshot.permissions = [{ resource_id: "*", entity_id: descriptor.owner_id, permission: 63, assign_via: "root" }];
    return root_id;
  }
  finishProvisioning(descriptor, root_id) { this.mutations++; Object.assign(this.snapshots.get(descriptor.hub_id).state, { root_id, status: "provisioned" }); }
  failProvisioning(descriptor, code) { Object.assign(this.snapshots.get(descriptor.hub_id).state, { status: "failed", error_code: code }); }
}

test("installation is explicit, repeatable and module-relative", async () => {
  const store = new MemoryStore();
  assert.equal((await validateInstallation({ store })).status, "not-installed");
  assert.equal((await install({ store })).changed, true);
  const mutations = store.mutations;
  assert.equal((await install({ store })).changed, false);
  assert.equal(store.mutations, mutations);
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../server/schemas/SCHEMA_MANIFEST.json")));
  assert.ok(manifest.install.concat(manifest.provision).every((entry) => !path.isAbsolute(entry.path) && !entry.path.includes("sources/") && !entry.path.includes("target/")));
});

test("existing hub and drumate shards are provisioned idempotently with common layering", async () => {
  const store = new MemoryStore();
  await install({ store });
  const first_hub = await provision({ store, context: { hub_id: hub.hub_id } });
  const first_user = await provision({ store, context: { hub_id: drumate.hub_id } });
  const mutations = store.mutations;
  assert.equal((await provision({ store, context: { host: "hub.example.test" } })).changed, false);
  assert.equal(store.mutations, mutations);
  assert.equal(first_hub.type, "hub");
  assert.equal(first_user.type, "drumate");
  assert.equal(Object.hasOwn(first_hub, "database_name"), false);
  assert.equal(Object.hasOwn(first_hub, "home_dir"), false);
  assert.ok(store.applied.every((entry) => !entry.includes("mfs_" + hub.hub_id) && !entry.includes("mfs_" + drumate.hub_id)));
  assert.deepEqual(schemaEntries("provision", "hub").map((entry) => entry.order), schemaEntries("provision", "hub").map((entry) => entry.order).slice().sort((a, b) => a - b));
});

test("missing objects and version conflicts fail closed without repairing shards", async () => {
  const store = new MemoryStore();
  await install({ store });
  await provision({ store, context: { hub_id: hub.hub_id } });
  const snapshot = store.snapshots.get(hub.hub_id);
  snapshot.routines = snapshot.routines.filter((name) => name !== "user_permission");
  const missing = await validateProvisioning({ store, context: { hub_id: hub.hub_id } });
  assert.equal(missing.status, "partial");
  assert.ok(missing.missing.includes("routine:user_permission"));
  snapshot.routines.push("user_permission");
  snapshot.state.schema_version = "future-version";
  const conflict = await validateProvisioning({ store, context: { hub_id: hub.hub_id } });
  assert.equal(conflict.status, "conflicting");
  await assert.rejects(() => provision({ store, context: { hub_id: hub.hub_id } }), (error) => error.code === "MFS_PROVISIONING_CONFLICT");
});

test("capability availability is tied to shard state, never entity locator presence", async () => {
  const store = new MemoryStore();
  await install({ store });
  assert.deepEqual(await capabilityAvailable({ store, context: { hub_id: hub.hub_id } }), { available: false, status: "installed" });
  await provision({ store, context: { hub_id: hub.hub_id } });
  assert.deepEqual(await capabilityAvailable({ store, context: { hub_id: hub.hub_id } }), { available: true, status: "provisioned" });
});
