"use strict";

const { MfsError } = require("./errors");

const ID_PATTERN = /^[a-f0-9]{16}$/i;

function identity(value, label = "node", fallback_hub_id = null) {
  const hub_id = value && (value.hub_id || fallback_hub_id);
  if (!value || !ID_PATTERN.test(hub_id || "") || !ID_PATTERN.test(value.nid || "")) {
    throw new MfsError("MFS_IDENTITY_INVALID", `${label} requires { hub_id, nid }`);
  }
  return { hub_id: hub_id.toLowerCase(), nid: value.nid.toLowerCase() };
}

function principalValue(value) {
  const principal_id = typeof value === "string" ? value : value && (value.uid || value.principal_id);
  if (!ID_PATTERN.test(principal_id || "")) {
    throw new MfsError("MFS_PRINCIPAL_INVALID", "MFS operation requires a trusted 16-character Session uid");
  }
  return { principal_id: principal_id.toLowerCase() };
}

function identities(values, label = "node") {
  if (!Array.isArray(values) || !values.length) throw new MfsError("MFS_NODES_REQUIRED", "At least one MFS node is required");
  return values.map((value) => identity(value, label));
}

class MfsFilesystem {
  constructor({ store, principal, content_store } = {}) {
    if (!store) throw new MfsError("MFS_STORE_REQUIRED", "MFS filesystem requires a store");
    this.store = store;
    this.principal = principalValue(principal);
    this.content_store = content_store || null;
  }

  listChildren({ location, cursor = null, limit = 100, sort = "name" } = {}) {
    return this.store.listChildrenAt(this.principal, identity(location, "location"), { cursor, limit, sort });
  }

  getNode({ node } = {}) {
    return this.store.getNode(this.principal, identity(node));
  }

  makeDirectory({ destination, name } = {}) {
    return this.store.makeDirectoryAt(this.principal, identity(destination, "destination"), name);
  }

  renameNode({ node, name } = {}) {
    return this.store.renameNode(this.principal, identity(node), name);
  }

  async removeNode({ node } = {}) {
    const removed = await this.store.removeNode(this.principal, identity(node));
    if (this.content_store && typeof this.content_store.remove === "function") {
      for (const entry of removed.nodes || []) {
        if (entry.storage_ref) await this.content_store.remove(entry.storage_ref);
      }
    }
    return removed;
  }

  moveNodes({ nodes, destination } = {}) {
    const sources = identities(nodes);
    const parent = identity(destination, "destination");
    if (sources.some((node) => node.hub_id !== parent.hub_id)) {
      throw new MfsError("MFS_MOVE_CROSS_SHARD", "moveNodes only supports a single resolved shard");
    }
    return this.store.moveNodes(this.principal, sources, parent);
  }

  copyTree({ sources, destination } = {}) {
    return this.store.copyTree(this.principal, identities(sources), identity(destination, "destination"), this.content_store);
  }

  async commitFile({ destination, payload_ref, metadata = {} } = {}) {
    const parent = identity(destination, "destination");
    if (payload_ref === undefined || payload_ref === null) {
      throw new MfsError("MFS_PAYLOAD_REQUIRED", "commitFile requires an opaque staged payload reference");
    }
    if (!this.content_store || typeof this.content_store.adopt !== "function") {
      throw new MfsError("MFS_CONTENT_STORE_REQUIRED", "commitFile requires a canonical content-store adapter");
    }
    const reservation = await this.store.reserveFile(this.principal, parent, metadata);
    let canonical_ref;
    try {
      canonical_ref = await this.content_store.adopt(payload_ref, { hub_id: parent.hub_id, nid: reservation.nid });
      return await this.store.commitReservedFile(this.principal, reservation, canonical_ref, metadata);
    } catch (error) {
      await this.store.releaseFileReservation(this.principal, reservation).catch(() => {});
      if (canonical_ref && typeof this.content_store.remove === "function") await this.content_store.remove(canonical_ref).catch(() => {});
      throw error;
    }
  }

  enumerateTree({ roots } = {}) {
    return this.store.enumerateTree(this.principal, identities(roots, "root"));
  }
}

module.exports = { MfsFilesystem, identity, identities, principalValue };
