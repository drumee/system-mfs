"use strict";

const { MfsError } = require("./errors");
const { LocalContentStore } = require("./content-store");
const { MfsFilesystem } = require("./filesystem");
const { publicNode } = require("./projection");
const { SqlMfsStore, readManifest } = require("./store");

function contextValue(context = {}) {
  const hub_id = typeof context.hub_id === "string" ? context.hub_id.toLowerCase() : null;
  const host = typeof context.host === "string" && context.host.trim() ? context.host.trim().toLowerCase() : null;
  if (hub_id && !/^[a-f0-9]{16}$/.test(hub_id)) throw new MfsError("MFS_CONTEXT_INVALID", "MFS context hub_id must be a 16-character entity id");
  if (!hub_id && !host) throw new MfsError("MFS_CONTEXT_INVALID", "MFS context requires a hub_id or trusted host");
  return hub_id ? { hub_id } : { host };
}

function expectedObjects() {
  const common = readManifest().objects.common;
  return { tables: common.tables, routines: common.functions.concat(common.procedures) };
}

async function validateInstallation({ store, database } = {}) {
  const value = store || new SqlMfsStore({ database });
  const snapshot = await value.inspectInstallation();
  const expected = ["system_mfs_installation", "system_mfs_provisioning"];
  if (!snapshot.tables.length) return { valid: false, status: "not-installed", missing: expected, conflicts: [] };
  const missing = expected.filter((name) => !snapshot.tables.includes(name));
  const conflicts = [];
  if (snapshot.marker && snapshot.marker.schema_version !== readManifest().schemaVersion) conflicts.push("installation schema version differs from the module");
  if (!snapshot.marker) missing.push("installation-marker");
  return { valid: !missing.length && !conflicts.length, status: conflicts.length ? "conflicting" : missing.length ? "partial" : "installed", missing, conflicts };
}

async function install({ store, database } = {}) {
  const value = store || new SqlMfsStore({ database });
  const before = await validateInstallation({ store: value });
  if (before.status === "conflicting") throw new MfsError("MFS_INSTALLATION_CONFLICT", "system-mfs installation conflicts with this module version", before);
  if (before.valid) return { ...before, changed: false };
  await value.installSchemas();
  const after = await validateInstallation({ store: value });
  if (!after.valid) throw new MfsError("MFS_INSTALLATION_INCOMPLETE", "system-mfs installation did not produce a valid schema", after);
  return { ...after, changed: true };
}

async function validateProvisioning({ store, database, context } = {}) {
  const value = store || new SqlMfsStore({ database });
  const target = contextValue(context);
  const installation = await validateInstallation({ store: value });
  if (!installation.valid) return { available: false, valid: false, status: installation.status, installation, context: target };
  const snapshot = await value.inspectContext(target);
  if (!snapshot.state && snapshot.database_exists) {
    const has_objects = snapshot.tables.length || snapshot.routines.length || snapshot.roots.length;
    if (!has_objects) return { available: false, valid: false, status: "installed", missing: ["provisioning"], conflicts: [], context: target, hub_id: snapshot.descriptor.hub_id, type: snapshot.descriptor.type };
  }
  const conflicts = [];
  const missing = [];
  const expected = expectedObjects();
  if (!snapshot.state) missing.push("provisioning-state");
  if (!snapshot.database_exists) conflicts.push("resolved entity shard database is absent");
  if (snapshot.state && snapshot.state.database_name !== snapshot.descriptor.db_name) conflicts.push("registered shard locator differs from the Yellow Pages entity descriptor");
  if (snapshot.state && snapshot.state.shard_type !== snapshot.descriptor.type) conflicts.push("registered shard class differs from the Yellow Pages entity descriptor");
  if (snapshot.state && snapshot.state.schema_version !== readManifest().schemaVersion) conflicts.push("shard schema version differs from the module");
  if (snapshot.state && snapshot.state.status !== "provisioned") missing.push(`status:${snapshot.state.status}`);
  for (const name of expected.tables) if (!snapshot.tables.includes(name)) missing.push(`table:${name}`);
  for (const name of expected.routines) if (!snapshot.routines.includes(name)) missing.push(`routine:${name}`);
  if (snapshot.database_exists && snapshot.roots.length !== 1) missing.push("root-node");
  const root = snapshot.roots[0];
  if (root && snapshot.state && snapshot.state.root_id && root.id !== snapshot.state.root_id) conflicts.push("registered root id differs from the shard root");
  if (root && (root.file_path !== "/" || root.parent_id !== "0" || root.category !== "root")) conflicts.push("shard root has incompatible MFS semantics");
  const owner_id = snapshot.descriptor.owner_id || snapshot.descriptor.hub_id;
  const owner = snapshot.permissions.filter((entry) => entry.resource_id === "*" && entry.entity_id === owner_id && Number(entry.permission) === 63);
  if (snapshot.database_exists && owner.length !== 1) missing.push("root-owner-permission");
  const valid = !missing.length && !conflicts.length;
  return { available: valid, valid, status: conflicts.length ? "conflicting" : missing.length ? "partial" : "provisioned", missing, conflicts, context: target, hub_id: snapshot.descriptor.hub_id, type: snapshot.descriptor.type, root_id: root && root.id || null };
}

async function provision({ store, database, context } = {}) {
  const value = store || new SqlMfsStore({ database });
  const target = contextValue(context);
  const report = await validateProvisioning({ store: value, context: target });
  if (report.valid) return { ...report, changed: false };
  if (report.status === "not-installed") throw new MfsError("MFS_NOT_INSTALLED", "system-mfs must be installed before provisioning", report);
  if (report.status === "partial") throw new MfsError("MFS_PROVISIONING_PARTIAL", "system-mfs shard has incomplete state and will not be rebuilt automatically", report);
  if (report.status === "conflicting") throw new MfsError("MFS_PROVISIONING_CONFLICT", "system-mfs shard conflicts with the resolved entity descriptor", report);
  const descriptor = await value.resolveShard(target);
  await value.beginProvisioning(descriptor);
  try {
    const root_id = await value.createNamespace(descriptor);
    await value.finishProvisioning(descriptor, root_id);
  } catch (error) {
    await value.failProvisioning(descriptor, error.code || "MFS_PROVISIONING_FAILED");
    throw error;
  }
  const after = await validateProvisioning({ store: value, context: target });
  if (!after.valid) throw new MfsError("MFS_PROVISIONING_INCOMPLETE", "system-mfs provisioning did not produce a valid shard capability", after);
  return { ...after, changed: true };
}

async function capabilityAvailable(options = {}) {
  const report = await validateProvisioning(options);
  return { available: report.valid, status: report.status };
}

class MfsNamespace {
  constructor({ store, database, context, principal } = {}) {
    this.store = store || new SqlMfsStore({ database });
    this.context = contextValue(context);
    this.principal = principal || context && (context.uid || context.principal_id);
  }
  async requireAvailable() {
    const report = await validateProvisioning({ store: this.store, context: this.context });
    if (!report.valid) throw new MfsError("MFS_CAPABILITY_UNAVAILABLE", "system-mfs is not provisioned for this shard", report);
    return report;
  }
  async operationContext() { const report = await this.requireAvailable(); return { hub_id: report.hub_id, uid: this.principal }; }
  async makeDirectory(parent_id, name) { return this.store.makeDirectory(await this.operationContext(), parent_id, name); }
  async resolveNode(node) { return this.store.resolveNode(await this.operationContext(), node); }
  async listChildren(parent_id) { return this.store.listChildren(await this.operationContext(), parent_id); }
}

module.exports = { LocalContentStore, MfsError, MfsFilesystem, MfsNamespace, SqlMfsStore, capabilityAvailable, install, provision, publicNode, validateInstallation, validateProvisioning };
