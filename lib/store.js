"use strict";

const fs = require("fs");
const path = require("path");
const { MfsError } = require("./errors");

const package_root = path.resolve(__dirname, "..");
const manifest_path = path.join(package_root, "schemas", "SCHEMA_MANIFEST.json");

function rows(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => rows(entry));
  return typeof value === "object" ? [value] : [];
}

function readManifest() {
  const manifest = JSON.parse(fs.readFileSync(manifest_path, "utf8"));
  const metadata = JSON.parse(fs.readFileSync(path.join(package_root, "package.json"), "utf8"));
  if (manifest.owner !== metadata.name || manifest.packageVersion !== metadata.version) {
    throw new MfsError("MFS_MANIFEST_INVALID", "system-mfs schema manifest does not match its package metadata");
  }
  return manifest;
}

function schemaFiles(section) {
  const manifest = readManifest();
  const entries = manifest[section];
  if (!Array.isArray(entries) || !entries.length) throw new MfsError("MFS_MANIFEST_INVALID", `system-mfs manifest has no ${section} entries`);
  return entries.slice().sort((left, right) => left.order - right.order).map((entry) => {
    if (!entry.path || path.isAbsolute(entry.path) || entry.path.split(/[\\/]+/).includes("..")) {
      throw new MfsError("MFS_MANIFEST_INVALID", `Invalid module-relative schema path: ${entry.path}`);
    }
    const filename = path.resolve(package_root, entry.path);
    if (!filename.startsWith(`${package_root}${path.sep}`) || !fs.statSync(filename).isFile()) {
      throw new MfsError("MFS_MANIFEST_INVALID", `Schema is outside or missing from system-mfs: ${entry.path}`);
    }
    return filename;
  });
}

function databaseName(principal_id) {
  if (!/^[a-f0-9]{16}$/i.test(principal_id || "")) {
    throw new MfsError("MFS_CONTEXT_INVALID", "MFS provisioning requires a 16-character Drumee principal id");
  }
  return `mfs_${principal_id.toLowerCase()}`;
}

function quoteIdentifier(value) {
  if (!/^[a-z0-9_]+$/i.test(value || "")) throw new MfsError("MFS_IDENTIFIER_INVALID", "Invalid MFS database identifier");
  return `\`${value}\``;
}

class SqlMfsStore {
  constructor({ database } = {}) {
    const query = database && (database.await_query || database.query);
    if (typeof query !== "function") {
      throw new MfsError("MFS_DATABASE_REQUIRED", "system-mfs requires a parameterized query adapter");
    }
    this.database = database;
    this.runtime_user = database.runtime_user || null;
    this.query = query.bind(database);
    this.executeScript = typeof database.executeScript === "function" ? database.executeScript.bind(database) : null;
  }

  async inspectInstallation() {
    const found = rows(await this.query("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('system_mfs_installation','system_mfs_provisioning') ORDER BY table_name"));
    const tables = found.map((row) => row.table_name);
    const marker = tables.includes("system_mfs_installation")
      ? rows(await this.query("SELECT singleton, schema_version, installed_at FROM system_mfs_installation WHERE singleton=1"))[0] || null
      : null;
    return { tables, marker };
  }

  async installSchemas() {
    if (!this.executeScript) throw new MfsError("MFS_SCRIPT_EXECUTOR_REQUIRED", "system-mfs installation requires a SQL script execution adapter");
    for (const filename of schemaFiles("install")) await this.executeScript(fs.readFileSync(filename, "utf8"), { database: "yp" });
  }

  async inspectIdentity({ organisation_id, principal_id }) {
    const result = rows(await this.query(`
      SELECT e.id, e.dom_id, e.db_name, e.home_dir, e.home_id, d.domain_id, o.sys_id AS organisation_id
      FROM entity e
      INNER JOIN drumate d ON d.id=e.id
      INNER JOIN organisation o ON o.domain_id=d.domain_id
      WHERE e.id=?
    `, principal_id));
    return result.filter((row) => Number(row.organisation_id) === Number(organisation_id));
  }

  async inspectContext({ organisation_id, principal_id }) {
    const name = databaseName(principal_id);
    const state = rows(await this.query(
      "SELECT organisation_id, principal_id, database_name, root_id, schema_version, status, error_code FROM system_mfs_provisioning WHERE organisation_id=? AND principal_id=?",
      organisation_id, principal_id
    ))[0] || null;
    const exists = rows(await this.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name=?", name)).length === 1;
    if (!exists) return { database_name: name, database_exists: false, state, tables: [], routines: [], roots: [], permissions: [] };
    const tables = rows(await this.query("SELECT table_name FROM information_schema.tables WHERE table_schema=? AND table_name IN ('media','permission') ORDER BY table_name", name)).map((row) => row.table_name);
    const routines = rows(await this.query("SELECT routine_name FROM information_schema.routines WHERE routine_schema=? AND routine_name IN ('mfs_clean_path','mfs_node_attr','mfs_make_dir','mfs_init_folders','mfs_show_node_by') ORDER BY routine_name", name)).map((row) => row.routine_name);
    const quoted = quoteIdentifier(name);
    const roots = tables.includes("media") ? rows(await this.query(`SELECT id, owner_id, file_path, parent_id, category FROM ${quoted}.media WHERE parent_id='0'`)) : [];
    const permissions = tables.includes("permission") ? rows(await this.query(`SELECT resource_id, entity_id, permission, assign_via FROM ${quoted}.permission WHERE resource_id='*'`)) : [];
    return { database_name: name, database_exists: true, state, tables, routines, roots, permissions };
  }

  async beginProvisioning({ organisation_id, principal_id, database_name: name }) {
    await this.query(
      "INSERT INTO system_mfs_provisioning (organisation_id,principal_id,database_name,root_id,schema_version,status,error_code,ctime,mtime) VALUES (?,?,?,?,?,'provisioning',NULL,UNIX_TIMESTAMP(),UNIX_TIMESTAMP())",
      organisation_id, principal_id, name, null, readManifest().schemaVersion
    );
  }

  async createNamespace({ principal_id, database_name: name }) {
    if (!this.executeScript) throw new MfsError("MFS_SCRIPT_EXECUTOR_REQUIRED", "system-mfs provisioning requires a SQL script execution adapter");
    for (const filename of schemaFiles("provision")) {
      const script = fs.readFileSync(filename, "utf8").replaceAll("{{DATABASE}}", name);
      await this.executeScript(script, { database: "yp" });
    }
    if (this.runtime_user) {
      if (!/^[a-z0-9_]+$/i.test(this.runtime_user)) throw new MfsError("MFS_DATABASE_USER_INVALID", "Invalid configured MFS runtime database user");
      await this.query(`GRANT SELECT,INSERT,UPDATE,DELETE,EXECUTE ON ${quoteIdentifier(name)}.* TO ${quoteIdentifier(this.runtime_user)}@'%'`);
    }
    const root = rows(await this.query("SELECT uniqueId() AS id"))[0];
    if (!root || !/^[a-f0-9]{16}$/i.test(root.id || "")) throw new MfsError("MFS_ID_GENERATION_FAILED", "The intrinsic uniqueId() function did not return an MFS root id");
    const quoted = quoteIdentifier(name);
    await this.query(`INSERT INTO ${quoted}.media (id,origin_id,owner_id,file_path,user_filename,parent_id,parent_path,extension,mimetype,category,status) VALUES (?,?,?,'/','','0','/','','root','root','active')`, root.id, principal_id, principal_id);
    await this.query(`INSERT INTO ${quoted}.permission (resource_id,entity_id,message,expiry_time,ctime,utime,permission,assign_via) VALUES ('*',?,'system-mfs root owner',0,UNIX_TIMESTAMP(),UNIX_TIMESTAMP(),63,'root')`, principal_id);
    return root.id;
  }

  async finishProvisioning({ organisation_id, principal_id, root_id }) {
    await this.query("UPDATE system_mfs_provisioning SET root_id=?,status='provisioned',error_code=NULL,mtime=UNIX_TIMESTAMP() WHERE organisation_id=? AND principal_id=? AND status='provisioning'", root_id, organisation_id, principal_id);
  }

  async failProvisioning({ organisation_id, principal_id }, code) {
    await this.query("UPDATE system_mfs_provisioning SET status='failed',error_code=?,mtime=UNIX_TIMESTAMP() WHERE organisation_id=? AND principal_id=? AND status<>'provisioned'", code, organisation_id, principal_id);
  }

  async makeDirectory({ principal_id }, parent_id, name) {
    const db = quoteIdentifier(databaseName(principal_id));
    return rows(await this.query(`CALL ${db}.mfs_make_dir(?,JSON_ARRAY(?),1)`, parent_id, name)).find((row) => row.nid) || null;
  }

  async resolveNode({ principal_id }, node) {
    const db = quoteIdentifier(databaseName(principal_id));
    return rows(await this.query(`CALL ${db}.mfs_node_attr(?)`, node)).find((row) => row.nid) || null;
  }

  async listChildren({ principal_id }, parent_id) {
    const db = quoteIdentifier(databaseName(principal_id));
    return rows(await this.query(`CALL ${db}.mfs_show_node_by(?,?,JSON_OBJECT())`, parent_id, principal_id)).filter((row) => row.nid);
  }
}

module.exports = { SqlMfsStore, databaseName, readManifest, rows, schemaFiles };
