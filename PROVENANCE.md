# Phase 4.6B system-mfs provenance

The standalone extraction source is
`drumee/transient:target/modules/system-mfs/` at commit
`078e71378a52acd06478d9df556a7cd5b4d6a223`. R2 changes package ownership and
standalone validation only; the validated Phase 4.6B runtime and SQL semantics
remain unchanged.

Pinned sources are `drumee/schemas` at
`cb838e255600a4ec3797dc7ac13659ad9d187421` and `drumee/setup-schemas` at
`1582eb557ce092dd2cc5fa6f9d533d64911f4dce`.

| Target | Historical evidence | Direct dependencies | Intentional difference |
|---|---|---|---|
| `schemas/context/001-mfs-core.sql::media` | `sources/schemas/common/tables/media.sql` | None beyond MariaDB | Retains the columns needed by historical folder operations; omits unrelated secondary indexes. |
| `permission` and root owner row | `sources/schemas/common/tables/permission.sql`, `permission_grant.sql`, `permission_make_owner.sql` | Principal id and namespace | Retains authoritative permission `63` for the owner without importing sharing and orphan-Hub policy. |
| `mfs_make_dir` | `sources/schemas/common/procedures/mfs/mfs_make_dir.sql` | `media`, path normalization, `yp.uniqueId()`, node attributes | Uses module-local path normalization, records the principal as owner/origin, and resignal errors instead of returning ambiguous result rows. |
| `mfs_init_folders` | `sources/schemas/common/procedures/mfs/mfs_init_folders.sql` and `sources/setup-schemas/lib/drumate.js::initFolders` | Root lookup, `mfs_make_dir` | Runs only after explicit context provisioning and never from identity bootstrap. |
| `mfs_node_attr`, `mfs_show_node_by` | `sources/schemas/common/procedures/mfs/mfs_node_attr.sql`, `mfs_show_node_by.sql` | Historical `media`; current listing also depends on Hub, DMZ, changelog and acknowledgement state | Preserves node result and direct-child listing semantics while deliberately removing non-core decoration. |
| lifecycle registry | No historical object cleanly distinguishes an identity placeholder from ready MFS | Yellow Page database and explicit context | New smallest module-owned state; required because historical `entity` locator fields are not reliable capability evidence. |
| per-context database creation | `sources/schemas/yellow_page/procedures/drumate/drumate_create.sql` and the Drumate factory | Historical per-user database | Creates only the proven MFS closure, not the complete Drumate/Hub/Team factory. |

`mfs_trash_init`, `mfs_changelog`, `mfs_ack`, Hub creation, filesystem-root
creation and the full factory template were inspected but are excluded from the
minimal vertical slice.
