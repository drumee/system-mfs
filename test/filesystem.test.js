"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { MfsFilesystem } = require("../lib");

const uid = "a000000000000001";
const hub_x = "b000000000000002";
const hub_y = "c000000000000003";

class MemoryStore {
  constructor() {
    this.serial = 10;
    this.nodes = new Map();
    this.add({ hub_id: hub_x, nid: "1000000000000001", parent_id: "0", filename: "Home", filetype: "root", filepath: "/" });
    this.add({ hub_id: hub_y, nid: "2000000000000001", parent_id: "0", filename: "Other", filetype: "root", filepath: "/" });
  }
  key(node) { return `${node.hub_id}:${node.nid}`; }
  add(node) { this.nodes.set(this.key(node), node); return node; }
  next() { return String(++this.serial).padStart(16, "0"); }
  async listChildrenAt(_principal, location, { cursor, limit }) { const offset = cursor ? Number(Buffer.from(cursor, "base64url").toString()) : 0; const all = [...this.nodes.values()].filter((node) => node.hub_id === location.hub_id && node.parent_id === location.nid); return { items: structuredClone(all.slice(offset, offset + limit)), next_cursor: all.length > offset + limit ? Buffer.from(String(offset + limit)).toString("base64url") : null }; }
  async getNode(_principal, identity) { return structuredClone(this.nodes.get(this.key(identity)) || null); }
  async makeDirectoryAt(_principal, destination, name) { const parent = this.nodes.get(this.key(destination)); const node = { hub_id: destination.hub_id, nid: this.next(), parent_id: destination.nid, filename: name, filetype: "folder", filepath: parent.filepath === "/" ? `/${name}` : `${parent.filepath}/${name}` }; this.add(node); return structuredClone(node); }
  async renameNode(_principal, identity, name) { const node = this.nodes.get(this.key(identity)); node.filename = name; return structuredClone(node); }
  async removeNode(_principal, identity) { const root = this.nodes.get(this.key(identity)); const removed = [...this.nodes.values()].filter((node) => node.hub_id === identity.hub_id && (node.nid === identity.nid || node.filepath.startsWith(`${root.filepath}/`))); for (const node of removed) this.nodes.delete(this.key(node)); return { node: identity, parent: { hub_id: identity.hub_id, nid: root.parent_id }, nodes: structuredClone(removed), hard_delete: true }; }
  async moveNodes(_principal, identities, destination) { const nodes = identities.map((identity) => { const node = this.nodes.get(this.key(identity)); const parent = this.nodes.get(this.key(destination)); const source_parent = { hub_id: node.hub_id, nid: node.parent_id }; node.parent_id = destination.nid; node.filepath = parent.filepath === "/" ? `/${node.filename}` : `${parent.filepath}/${node.filename}`; return { ...structuredClone(node), source_parent, destination }; }); return { nodes, destination }; }
  async reserveFile(_principal, destination, metadata) { return { hub_id: destination.hub_id, nid: this.next(), destination, filename: metadata.filename }; }
  async commitReservedFile(_principal, reservation, canonical_ref, metadata) { const node = { hub_id: reservation.hub_id, nid: reservation.nid, parent_id: reservation.destination.nid, filename: reservation.filename, filetype: metadata.filetype || "other", filesize: metadata.size || 0, filepath: `/${reservation.filename}`, metadata: { storage_ref: canonical_ref }, storage_ref: canonical_ref }; this.add(node); return structuredClone(node); }
  async releaseFileReservation() {}
  async enumerateTree(_principal, roots) { const entries = []; for (const root of roots) { const node = this.nodes.get(this.key(root)); entries.push(...[...this.nodes.values()].filter((entry) => entry.hub_id === root.hub_id && (entry.nid === root.nid || (node.filepath === "/" ? entry.filepath.startsWith("/") : entry.filepath.startsWith(`${node.filepath}/`))))); } return { roots, entries: structuredClone(entries) }; }
  async copyTree(principal, sources, destination, content_store) { const created = []; for (const source of sources) { const original = this.nodes.get(this.key(source)); const reservation = await this.reserveFile(principal, destination, { filename: original.filename }); const canonical_ref = await content_store.copy(original.storage_ref, { hub_id: destination.hub_id, nid: reservation.nid }); const item = await this.commitReservedFile(principal, reservation, canonical_ref, original); created.push({ source, node: { hub_id: item.hub_id, nid: item.nid }, item }); } return { nodes: created, destination }; }
}

class MemoryContentStore {
  constructor() { this.staged = new Map([["stage-1", Buffer.from("hello")]]); this.canonical = new Map(); }
  async adopt(payload_ref, target) { const value = this.staged.get(payload_ref); assert.ok(value); const ref = `content:${target.hub_id}:${target.nid}`; this.canonical.set(ref, value); this.staged.delete(payload_ref); return ref; }
  async copy(ref, target) { const next = `content:${target.hub_id}:${target.nid}`; this.canonical.set(next, this.canonical.get(ref)); return next; }
  async remove(ref) { this.canonical.delete(ref); }
}

test("filesystem assumes prior ACL grant and preserves canonical public identities", async () => {
  const store = new MemoryStore();
  const content_store = new MemoryContentStore();
  const mfs = new MfsFilesystem({ store, principal: uid, content_store });
  const x_root = { hub_id: hub_x, nid: "1000000000000001" };
  const y_root = { hub_id: hub_y, nid: "2000000000000001" };
  const docs = await mfs.makeDirectory({ destination: x_root, name: "Documents" });
  const archive = await mfs.makeDirectory({ destination: x_root, name: "Archive" });
  const first = await mfs.listChildren({ location: x_root, limit: 1 });
  assert.equal(first.items.length, 1);
  assert.ok(first.next_cursor);
  await mfs.renameNode({ node: { hub_id: hub_x, nid: docs.nid }, name: "Docs" });
  await mfs.moveNodes({ nodes: [{ hub_id: hub_x, nid: docs.nid }], destination: { hub_id: hub_x, nid: archive.nid } });
  const file = await mfs.commitFile({ destination: x_root, payload_ref: "stage-1", metadata: { filename: "readme.txt", size: 5, filetype: "text" } });
  const copied = await mfs.copyTree({ sources: [{ hub_id: hub_x, nid: file.nid }], destination: y_root });
  assert.equal(copied.nodes[0].node.hub_id, hub_y);
  assert.equal((await mfs.removeNode({ node: { hub_id: hub_x, nid: archive.nid } })).hard_delete, true);
  assert.equal(await mfs.getNode({ node: { hub_id: hub_x, nid: docs.nid } }), null);
  assert.equal(typeof mfs.resolveAccess, "undefined");
});

test("cross-shard move is rejected and payload references remain opaque", async () => {
  const mfs = new MfsFilesystem({ store: new MemoryStore(), principal: uid, content_store: new MemoryContentStore() });
  assert.throws(() => mfs.moveNodes({ nodes: [{ hub_id: hub_x, nid: "1000000000000001" }], destination: { hub_id: hub_y, nid: "2000000000000001" } }), (error) => error.code === "MFS_MOVE_CROSS_SHARD");
  await assert.rejects(() => mfs.commitFile({ destination: { hub_id: hub_x, nid: "1000000000000001" }, metadata: { filename: "x" } }), (error) => error.code === "MFS_PAYLOAD_REQUIRED");
});
