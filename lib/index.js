"use strict";

const { MfsError } = require("./errors");
const { SqlMfsStore, databaseName, readManifest } = require("./store");

const EXPECTED_TABLES = ["media", "permission"];
const EXPECTED_ROUTINES = ["mfs_clean_path", "mfs_init_folders", "mfs_make_dir", "mfs_node_attr", "mfs_show_node_by"];

function contextValue(context = {}) {
  const organisation_id = Number(context.organisation_id);
  const principal_id = context.principal_id;
  if (!Number.isInteger(organisation_id) || organisation_id < 1 || !/^[a-f0-9]{16}$/i.test(principal_id || "")) {
    throw new MfsError("MFS_CONTEXT_INVALID", "MFS context requires an organisation_id and 16-character principal_id");
  }
  return { organisation_id, principal_id: principal_id.toLowerCase() };
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
  const identities = await value.inspectIdentity(target);
  if (identities.length !== 1) return { available: false, valid: false, status: "conflicting", conflicts: ["context principal is absent or ambiguous in the organisation"], context: target };
  const snapshot = await value.inspectContext(target);
  const expected_name = databaseName(target.principal_id);
  if (!snapshot.state && !snapshot.database_exists) return { available: false, valid: false, status: "installed", missing: ["provisioning"], conflicts: [], context: target };
  const conflicts = [];
  const missing = [];
  if (!snapshot.state) missing.push("provisioning-state");
  if (!snapshot.database_exists) missing.push("context-database");
  if (snapshot.state && snapshot.state.database_name !== expected_name) conflicts.push("context database locator differs from the deterministic module locator");
  if (snapshot.state && snapshot.state.schema_version !== readManifest().schemaVersion) conflicts.push("context schema version differs from the module");
  if (snapshot.state && snapshot.state.status !== "provisioned") missing.push(`status:${snapshot.state.status}`);
  for (const name of EXPECTED_TABLES) if (!snapshot.tables.includes(name)) missing.push(`table:${name}`);
  for (const name of EXPECTED_ROUTINES) if (!snapshot.routines.includes(name)) missing.push(`routine:${name}`);
  if (snapshot.database_exists && snapshot.roots.length !== 1) missing.push("root-node");
  const root = snapshot.roots[0];
  if (root && snapshot.state && snapshot.state.root_id && root.id !== snapshot.state.root_id) conflicts.push("registered root id differs from the namespace root");
  if (root && (root.owner_id !== target.principal_id || root.file_path !== "/" || root.parent_id !== "0" || root.category !== "root")) conflicts.push("namespace root has incompatible historical semantics");
  const owner = snapshot.permissions.filter((entry) => entry.resource_id === "*" && entry.entity_id === target.principal_id && Number(entry.permission) === 63);
  if (snapshot.database_exists && owner.length !== 1) missing.push("root-owner-permission");
  const valid = !missing.length && !conflicts.length;
  return { available: valid, valid, status: conflicts.length ? "conflicting" : missing.length ? "partial" : "provisioned", missing, conflicts, context: target, database_name: expected_name, root_id: root && root.id || null };
}

async function provision({ store, database, context } = {}) {
  const value = store || new SqlMfsStore({ database });
  const target = contextValue(context);
  const report = await validateProvisioning({ store: value, context: target });
  if (report.valid) return { ...report, changed: false };
  if (report.status === "not-installed") throw new MfsError("MFS_NOT_INSTALLED", "system-mfs must be installed before provisioning", report);
  if (report.status === "partial") throw new MfsError("MFS_PROVISIONING_PARTIAL", "system-mfs context has incomplete state and will not be rebuilt automatically", report);
  if (report.status === "conflicting") throw new MfsError("MFS_PROVISIONING_CONFLICT", "system-mfs context conflicts with the requested target", report);
  const name = databaseName(target.principal_id);
  await value.beginProvisioning({ ...target, database_name: name });
  try {
    const root_id = await value.createNamespace({ ...target, database_name: name });
    await value.finishProvisioning({ ...target, root_id });
  } catch (error) {
    await value.failProvisioning(target, error.code || "MFS_PROVISIONING_FAILED");
    throw error;
  }
  const after = await validateProvisioning({ store: value, context: target });
  if (!after.valid) throw new MfsError("MFS_PROVISIONING_INCOMPLETE", "system-mfs provisioning did not produce a valid namespace", after);
  return { ...after, changed: true };
}

async function capabilityAvailable(options = {}) {
  const report = await validateProvisioning(options);
  return { available: report.valid, status: report.status };
}

class MfsNamespace {
  constructor({ store, database, context } = {}) {
    this.store = store || new SqlMfsStore({ database });
    this.context = contextValue(context);
  }
  async requireAvailable() {
    const report = await validateProvisioning({ store: this.store, context: this.context });
    if (!report.valid) throw new MfsError("MFS_CAPABILITY_UNAVAILABLE", "system-mfs is not provisioned for this context", report);
    return report;
  }
  async makeDirectory(parent_id, name) { await this.requireAvailable(); return this.store.makeDirectory(this.context, parent_id, name); }
  async resolveNode(node) { await this.requireAvailable(); return this.store.resolveNode(this.context, node); }
  async listChildren(parent_id) { await this.requireAvailable(); return this.store.listChildren(this.context, parent_id); }
}

module.exports = { MfsError, MfsNamespace, SqlMfsStore, capabilityAvailable, install, provision, validateInstallation, validateProvisioning };
