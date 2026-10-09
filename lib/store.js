"use strict";

const fs = require("fs");
const path = require("path");
const { MfsError } = require("./errors");

const package_root = path.resolve(__dirname, "..");
const manifest_path = path.join(package_root, "server", "schemas", "SCHEMA_MANIFEST.json");
const ID_PATTERN = /^[a-f0-9]{16}$/i;

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

function schemaEntries(section, shard_type) {
  const entries = readManifest()[section];
  if (!Array.isArray(entries) || !entries.length) throw new MfsError("MFS_MANIFEST_INVALID", `system-mfs manifest has no ${section} entries`);
  return entries.filter((entry) => !shard_type || entry.schemaClass === "common" || entry.schemaClass === shard_type)
    .slice().sort((left, right) => left.order - right.order);
}

function schemaFiles(section, shard_type) {
  return schemaEntries(section, shard_type).map((entry) => {
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

function quoteIdentifier(value) {
  if (!/^[a-z0-9_]+$/i.test(value || "")) throw new MfsError("MFS_IDENTIFIER_INVALID", "Invalid internal shard database identifier");
  return `\`${value}\``;
}

function fileName(value) {
  const name = String(value || "").trim();
  if (!name || name === "." || name === ".." || /[\\/\0]/.test(name) || name.length > 128) {
    throw new MfsError("MFS_NAME_INVALID", "MFS node name must be a non-empty path segment of at most 128 characters");
  }
  return name;
}

function pageLimit(value) {
  const limit = Number(value || 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new MfsError("MFS_PAGE_INVALID", "MFS listing limit must be between 1 and 500");
  return limit;
}

function pageOffset(cursor) {
  if (cursor === null || cursor === undefined || cursor === "") return 0;
  const decoded = Number.parseInt(Buffer.from(String(cursor), "base64url").toString("utf8"), 10);
  if (!Number.isInteger(decoded) || decoded < 0) throw new MfsError("MFS_CURSOR_INVALID", "Invalid MFS listing cursor");
  return decoded;
}

function storageRef(node) {
  try {
    const metadata = typeof node.metadata === "string" ? JSON.parse(node.metadata) : node.metadata || {};
    return metadata.storage_ref || null;
  } catch (_) {
    return null;
  }
}

function shardDescriptor(value) {
  const descriptor = value && { ...value };
  if (!descriptor || !ID_PATTERN.test(descriptor.hub_id || descriptor.id || "")) throw new MfsError("MFS_SHARD_NOT_FOUND", "Resolved shard has no valid hub identity");
  descriptor.hub_id = String(descriptor.hub_id || descriptor.id).toLowerCase();
  if (!/^[a-z0-9_]+$/i.test(descriptor.db_name || "")) throw new MfsError("MFS_SHARD_INVALID", "Resolved shard has no valid internal database name");
  if (!["hub", "drumate"].includes(descriptor.type)) throw new MfsError("MFS_SHARD_TYPE_UNSUPPORTED", "system-mfs supports hub and drumate shards only");
  return descriptor;
}

class SqlMfsStore {
  constructor({ database, shard_resolver } = {}) {
    const query = database && (database.await_query || database.query);
    if (typeof query !== "function") throw new MfsError("MFS_DATABASE_REQUIRED", "system-mfs requires a parameterized query adapter");
    this.database = database;
    this.query = query.bind(database);
    this.executeScript = typeof database.executeScript === "function" ? database.executeScript.bind(database) : null;
    this.shard_resolver = shard_resolver || database.resolveShard && database.resolveShard.bind(database) || null;
  }

  async resolveShard({ hub_id, host } = {}) {
    let found;
    if (this.shard_resolver) found = await this.shard_resolver({ hub_id, host });
    else if (hub_id) {
      found = rows(await this.query("SELECT e.id AS hub_id,e.db_name,e.db_host,e.fs_host,e.home_dir,e.home_id,e.type FROM entity e WHERE e.id=? LIMIT 1", hub_id))[0];
    } else if (host) {
      found = rows(await this.query("SELECT e.id AS hub_id,e.db_name,e.db_host,e.fs_host,e.home_dir,e.home_id,e.type FROM vhost v INNER JOIN entity e ON e.id=v.id WHERE v.fqdn=? LIMIT 1", host))[0];
    } else throw new MfsError("MFS_SHARD_CONTEXT_REQUIRED", "Shard resolution requires an explicit hub_id or trusted host");
    if (found && found.type === "drumate") found.owner_id = found.hub_id;
    else if (found && found.type === "hub") {
      const owner = rows(await this.query("SELECT owner_id FROM hub WHERE id=? LIMIT 1", found.hub_id))[0];
      found.owner_id = owner && owner.owner_id;
    }
    return shardDescriptor(found);
  }

  async inspectInstallation() {
    const found = rows(await this.query("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('system_mfs_installation','system_mfs_provisioning') ORDER BY table_name"));
    const tables = found.map((row) => row.table_name);
    const marker = tables.includes("system_mfs_installation") ? rows(await this.query("SELECT singleton,schema_version,installed_at FROM system_mfs_installation WHERE singleton=1"))[0] || null : null;
    return { tables, marker };
  }

  async installSchemas() {
    if (!this.executeScript) throw new MfsError("MFS_SCRIPT_EXECUTOR_REQUIRED", "system-mfs installation requires a SQL script execution adapter");
    for (const filename of schemaFiles("install")) await this.executeScript(fs.readFileSync(filename, "utf8"), { database: "yp" });
  }

  async inspectContext(context) {
    const descriptor = await this.resolveShard(context);
    const state = rows(await this.query("SELECT hub_id,shard_type,database_name,root_id,schema_version,status,error_code FROM system_mfs_provisioning WHERE hub_id=?", descriptor.hub_id))[0] || null;
    const exists = rows(await this.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name=?", descriptor.db_name)).length === 1;
    if (!exists) return { descriptor, database_exists: false, state, tables: [], routines: [], roots: [], permissions: [] };
    const tables = rows(await this.query("SELECT table_name FROM information_schema.tables WHERE table_schema=? AND table_name IN ('media','permission') ORDER BY table_name", descriptor.db_name)).map((row) => row.table_name);
    const expected = readManifest().objects.common.functions.concat(readManifest().objects.common.procedures);
    const routines = rows(await this.query("SELECT routine_name FROM information_schema.routines WHERE routine_schema=? ORDER BY routine_name", descriptor.db_name)).map((row) => row.routine_name).filter((name) => expected.includes(name));
    const db = quoteIdentifier(descriptor.db_name);
    const roots = tables.includes("media") ? rows(await this.query(`SELECT id,owner_id,file_path,parent_id,category FROM ${db}.media WHERE parent_id='0'`)) : [];
    const permissions = tables.includes("permission") ? rows(await this.query(`SELECT resource_id,entity_id,permission,assign_via FROM ${db}.permission WHERE resource_id='*'`)) : [];
    return { descriptor, database_exists: true, state, tables, routines, roots, permissions };
  }

  async beginProvisioning(descriptor) {
    await this.query("INSERT INTO system_mfs_provisioning (hub_id,shard_type,database_name,root_id,schema_version,status,error_code,ctime,mtime) VALUES (?,?,?,NULL,?,'provisioning',NULL,UNIX_TIMESTAMP(),UNIX_TIMESTAMP())", descriptor.hub_id, descriptor.type, descriptor.db_name, readManifest().schemaVersion);
  }

  async createNamespace(descriptor) {
    if (!this.executeScript) throw new MfsError("MFS_SCRIPT_EXECUTOR_REQUIRED", "system-mfs provisioning requires a SQL script execution adapter");
    for (const filename of schemaFiles("provision", descriptor.type)) await this.executeScript(fs.readFileSync(filename, "utf8"), { database: descriptor.db_name });
    const db = quoteIdentifier(descriptor.db_name);
    let root = rows(await this.query(`SELECT id FROM ${db}.media WHERE parent_id='0' LIMIT 1`))[0];
    if (!root) root = rows(await this.query(`CALL ${db}.mfs_create_node(?,?)`, JSON.stringify({ owner_id: descriptor.owner_id || descriptor.hub_id, pid: "0", filename: "", category: "root", mimetype: "special", showResults: 1 }), "{}" )).find((entry) => entry.nid);
    if (!root || !ID_PATTERN.test(root.id || root.nid || "")) throw new MfsError("MFS_ROOT_CREATION_FAILED", "MFS shard root could not be created");
    const root_id = String(root.id || root.nid).toLowerCase();
    await this.query(`INSERT INTO ${db}.permission (resource_id,entity_id,message,expiry_time,ctime,utime,permission,assign_via) VALUES ('*',?,'system-mfs shard owner',0,UNIX_TIMESTAMP(),UNIX_TIMESTAMP(),63,'root') ON DUPLICATE KEY UPDATE permission=VALUES(permission),assign_via=VALUES(assign_via)`, descriptor.owner_id || descriptor.hub_id);
    return root_id;
  }

  async finishProvisioning(descriptor, root_id) { await this.query("UPDATE system_mfs_provisioning SET root_id=?,status='provisioned',error_code=NULL,mtime=UNIX_TIMESTAMP() WHERE hub_id=? AND status='provisioning'", root_id, descriptor.hub_id); }
  async failProvisioning(descriptor, code) { await this.query("UPDATE system_mfs_provisioning SET status='failed',error_code=?,mtime=UNIX_TIMESTAMP() WHERE hub_id=? AND status<>'provisioned'", code, descriptor.hub_id); }
  async shard(node) { return this.resolveShard({ hub_id: node.hub_id }); }
  async db(node) { return quoteIdentifier((await this.shard(node)).db_name); }

  async makeDirectory(context, parent_id, name) { return this.makeDirectoryAt({ principal_id: context.uid || context.principal_id }, { hub_id: context.hub_id, nid: parent_id }, name); }
  async resolveNode(context, node) { return this.getNode(null, { hub_id: context.hub_id, nid: node }); }
  async listChildren(context, parent_id) { return (await this.listChildrenAt({ principal_id: context.uid || context.principal_id }, { hub_id: context.hub_id, nid: parent_id }, { limit: 500 })).items; }

  async getNode(_principal, node) {
    const db = await this.db(node);
    const found = rows(await this.query(`CALL ${db}.mfs_node_attr(?)`, node.nid)).find((entry) => entry.nid) || null;
    return found && { hub_id: node.hub_id, ...found, storage_ref: storageRef(found) };
  }

  async effectivePermission(uid, node) {
    const db = await this.db(node);
    const found = rows(await this.query(`SELECT ${db}.user_permission(?,?) AS permission`, uid, node.nid))[0];
    return Number(found && found.permission || 0);
  }

  async listChildrenAt(_principal, location, { cursor, limit, sort } = {}) {
    const db = await this.db(location);
    const size = pageLimit(limit);
    const offset = pageOffset(cursor);
    const result = rows(await this.query(`CALL ${db}.mfs_list_children(?,?,?,?)`, location.nid, offset, size + 1, ["name", "mtime", "size"].includes(sort) ? sort : "name")).filter((entry) => entry.nid);
    const more = result.length > size;
    return { items: result.slice(0, size).map((item) => ({ hub_id: location.hub_id, ...item, storage_ref: storageRef(item) })), next_cursor: more ? Buffer.from(String(offset + size)).toString("base64url") : null };
  }

  async makeDirectoryAt({ principal_id }, destination, name) {
    const db = await this.db(destination);
    const found = rows(await this.query(`CALL ${db}.mfs_make_dir(?,?,?)`, destination.nid, fileName(name), principal_id)).find((entry) => entry.nid) || null;
    return found && { hub_id: destination.hub_id, ...found };
  }

  async renameNode(_principal, node, name) {
    const db = await this.db(node);
    const found = rows(await this.query(`CALL ${db}.mfs_rename(?,?)`, node.nid, fileName(name))).find((entry) => entry.nid) || null;
    return found && { hub_id: node.hub_id, ...found };
  }

  async removeNode(_principal, node) {
    const db = await this.db(node);
    const removed = rows(await this.query(`CALL ${db}.mfs_hard_remove(?)`, node.nid)).filter((entry) => entry.nid).map((entry) => ({ hub_id: node.hub_id, ...entry, storage_ref: storageRef(entry) }));
    if (!removed.length) throw new MfsError("MFS_NODE_NOT_FOUND", "MFS node does not exist");
    return { node, parent: { hub_id: node.hub_id, nid: removed[0].parent_id }, nodes: removed, hard_delete: true };
  }

  async moveNodes(_principal, nodes, destination) {
    const db = await this.db(destination);
    const moved = rows(await this.query(`CALL ${db}.mfs_move_nodes(?,?)`, JSON.stringify(nodes.map((node) => node.nid)), destination.nid)).filter((entry) => entry.nid).map((entry) => ({ hub_id: destination.hub_id, ...entry, destination }));
    return { nodes: moved, destination };
  }

  async reserveFile(_principal, destination, metadata = {}) {
    const descriptor = await this.shard(destination);
    const id = rows(await this.query("SELECT uniqueId() AS id"))[0];
    if (!id || !ID_PATTERN.test(id.id || "")) throw new MfsError("MFS_ID_GENERATION_FAILED", "Could not reserve an MFS node id");
    return { hub_id: destination.hub_id, nid: id.id.toLowerCase(), destination, filename: fileName(metadata.filename), descriptor };
  }

  async commitReservedFile({ principal_id }, reservation, canonical_ref, metadata = {}) {
    const db = quoteIdentifier(reservation.descriptor.db_name);
    const extension = String(metadata.extension || "").replace(/^\./, "").slice(0, 100);
    const filename = extension && reservation.filename.endsWith(`.${extension}`) ? reservation.filename.slice(0, -(extension.length + 1)) : reservation.filename;
    const attributes = { nid: reservation.nid, owner_id: principal_id, pid: reservation.destination.nid, filename, ext: extension, mimetype: metadata.mimetype || "application/octet-stream", category: metadata.filetype || "other", filesize: Number(metadata.size || 0), showResults: 1 };
    const data = { ...(metadata.metadata || {}), storage_ref: canonical_ref };
    const found = rows(await this.query(`CALL ${db}.mfs_create_node(?,?)`, JSON.stringify(attributes), JSON.stringify(data))).find((entry) => entry.nid) || null;
    return found && { hub_id: reservation.hub_id, ...found, storage_ref: canonical_ref };
  }

  async releaseFileReservation() {}

  async enumerateTree(_principal, roots) {
    const entries = [];
    for (const root of roots) {
      const db = await this.db(root);
      const found = rows(await this.query(`CALL ${db}.mfs_enumerate_tree(?)`, root.nid)).filter((entry) => entry.nid);
      if (!found.length) throw new MfsError("MFS_NODE_NOT_FOUND", "MFS tree root does not exist", root);
      for (const entry of found) entries.push({ hub_id: root.hub_id, root_nid: root.nid, root_path: found[0].filepath, ...entry, storage_ref: storageRef(entry) });
    }
    return { roots, entries };
  }

  async copyTree(principal, sources, destination, content_store) {
    const created = [];
    for (const source of sources) {
      const manifest = await this.enumerateTree(principal, [source]);
      const by_source = new Map();
      for (const entry of manifest.entries) {
        const parent = entry.nid === source.nid ? destination : by_source.get(entry.parent_id);
        if (!parent) throw new MfsError("MFS_COPY_ORDER_INVALID", "MFS copy manifest is not parent-first");
        if (["folder", "root"].includes(entry.filetype)) {
          const folder = await this.makeDirectoryAt(principal, parent, entry.filename || "copy");
          const value = { hub_id: destination.hub_id, nid: folder.nid };
          by_source.set(entry.nid, value);
          created.push({ source: { hub_id: source.hub_id, nid: entry.nid }, node: value, item: folder });
        } else {
          if (!content_store || typeof content_store.copy !== "function") throw new MfsError("MFS_CONTENT_STORE_REQUIRED", "Cross-shard copy requires canonical content copy support");
          const reservation = await this.reserveFile(principal, parent, { filename: entry.filename + (entry.ext ? `.${entry.ext}` : "") });
          const canonical_ref = await content_store.copy(entry.storage_ref, { hub_id: destination.hub_id, nid: reservation.nid });
          try {
            const item = await this.commitReservedFile(principal, reservation, canonical_ref, { filename: reservation.filename, extension: entry.ext, filetype: entry.filetype, mimetype: entry.mimetype, size: entry.filesize });
            const value = { hub_id: destination.hub_id, nid: item.nid };
            by_source.set(entry.nid, value);
            created.push({ source: { hub_id: source.hub_id, nid: entry.nid }, node: value, item });
          } catch (error) {
            if (content_store.remove) await content_store.remove(canonical_ref).catch(() => {});
            throw error;
          }
        }
      }
    }
    return { nodes: created, destination };
  }
}

module.exports = { SqlMfsStore, quoteIdentifier, readManifest, rows, schemaEntries, schemaFiles, shardDescriptor };
