"use strict";

class MfsError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "MfsError";
    this.code = code;
    this.details = details;
  }
}

module.exports = { MfsError };
