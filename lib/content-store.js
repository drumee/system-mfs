"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { MfsError } = require("./errors");

const REF_PATTERN = /^mfs-content:([a-f0-9]{16}):([a-f0-9]{16})$/i;

class LocalContentStore {
  constructor({ root, staging } = {}) {
    if (!root || !path.isAbsolute(root)) throw new MfsError("MFS_CONTENT_ROOT_INVALID", "Canonical content root must be an absolute path");
    if (!staging || typeof staging.claim !== "function") throw new MfsError("MFS_STAGING_ADAPTER_REQUIRED", "Canonical content store requires an opaque staging adapter");
    this.root = root;
    this.staging = staging;
    fs.mkdirSync(root, { recursive: true });
  }

  ref(target) { return `mfs-content:${target.hub_id}:${target.nid}`; }

  filename(ref) {
    const matched = REF_PATTERN.exec(ref || "");
    if (!matched) throw new MfsError("MFS_CONTENT_REF_INVALID", "Invalid canonical MFS content reference");
    return path.join(this.root, matched[1].toLowerCase(), matched[2].toLowerCase());
  }

  async adopt(payload_ref, target) {
    const source = this.staging.claim(payload_ref);
    const ref = this.ref(target);
    const destination = this.filename(ref);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    try {
      fs.renameSync(source, destination);
    } catch (error) {
      if (error.code !== "EXDEV") throw error;
      fs.copyFileSync(source, destination);
      fs.rmSync(source, { force: true });
    }
    return ref;
  }

  async copy(ref, target) {
    const destination_ref = this.ref(target);
    const destination = this.filename(destination_ref);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(this.filename(ref), destination);
    return destination_ref;
  }

  async read(ref) { return fs.promises.readFile(this.filename(ref)); }
  async remove(ref) { fs.rmSync(this.filename(ref), { force: true }); }
}

module.exports = { LocalContentStore };
