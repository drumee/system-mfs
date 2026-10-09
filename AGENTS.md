# system-mfs contribution rules

- Preserve CommonJS and Node.js 18+ compatibility.
- Keep this package independently installable and MFS-specific.
- Do not add platform identity creation, Finder, Window Manager, Hub, DMZ,
  Team, chat, conference or tasks. Canonical content storage is an MFS
  responsibility; browser upload protocols, temporary chunk/session state,
  archive jobs and transfer progress are not.
- Keep schemas, migrations and provisioning knowledge package-owned under
  `schemas/` and represented by the single canonical manifest
  `server/schemas/SCHEMA_MANIFEST.json`.
- Preserve explicit installation and existing-shard provisioning lifecycle state.
- Do not infer MFS readiness from `entity.db_name`, `entity.home_dir` or
  `entity.home_id`.
- Do not add hidden imports from transient, sibling repositories, `target/**`,
  `sources/**`, parent `node_modules` or `NODE_PATH`.
- Preserve snake_case data fields and the validated Phase 4.8 API method names.
- `npm test` and `npm pack` must work from a standalone clone.
- Do not publish without explicit release authorization.
