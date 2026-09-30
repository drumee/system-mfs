"use strict";

const PUBLIC_NODE_FIELDS = [
  "hub_id", "nid", "parent_id", "filename", "filetype", "filesize",
  "mimetype", "ext", "ctime", "mtime", "status", "rank", "filepath"
];

function publicNode(value) {
  if (!value || typeof value !== "object") return value || null;
  const result = {};
  for (const field of PUBLIC_NODE_FIELDS) {
    if (value[field] !== undefined && value[field] !== null) result[field] = value[field];
  }
  return result;
}

module.exports = { PUBLIC_NODE_FIELDS, publicNode };
