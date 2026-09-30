# Phase 4.8 system-mfs provenance

The original standalone extraction came from
`drumee/transient:target/modules/system-mfs/` at
`078e71378a52acd06478d9df556a7cd5b4d6a223`. The Phase 4.8 realignment uses the
pinned `drumee/schemas` snapshot and the pinned historical `server-team`
snapshot `7fb16c449ed09258c501e88e3c87a4d71c51a941` as behavioral evidence.

| Target | Historical evidence | Intentional Phase 4.8 difference |
|---|---|---|
| `schemas/common/tables/media.sql` | `schemas/common/tables/media.sql` | Minimal generic table and indexes only. |
| `schemas/common/tables/permission.sql` | `schemas/common/tables/permission.sql` | Retains MFS grants without importing permission administration services. |
| `parent_permission`, `user_permission`, `user_expiry` | `schemas/common/procedures/mfs/{parent-permission,user-permission,user_expiry}.sql` | Preserves effective node privilege semantics as MFS-owned functions, one object per file. |
| `mfs_create_node` | `schemas/common/procedures/mfs/mfs_create_node.sql` | Minimal transaction and canonical row creation without filecap, quota, cross-Hub decoration, or public infrastructure fields. |
| listing/get/mkdir/rename | historical MFS procedures of the same names | Narrow procedure-backed Phase 4.8 behavior with explicit DTO projection above the package. |
| `mfs_hard_remove` | `mfs_purge.sql` | Hard deletion only; trash, retention, versions, disk usage, and changelog are excluded. |
| `mfs_move_nodes` | `mfs_move_all.sql` | Same-shard transactional move and cycle checks; cross-shard orchestration stays in JavaScript. |
| `mfs_enumerate_tree` | `mfs_manifest.sql` | Generic recursive tree rows only; no DMZ, Hub-link expansion, filecap, or physical paths. |
| shard resolution | `server-core/lib/session.js::_initHub`, `yellow_page/procedures/hub/get_hub.sql`, historical Factory | Uses existing `hub`/`drumate` entity shards instead of principal-derived databases. |
| canonical content | `server-team/service/private/_node-storage.js` | Opaque staging adoption; HTTP/chunk/session behavior remains in `mfs-transfer`. |

SQL deliberately not duplicated here:

- server ACL: `acl_check`, `acl_array_check_next`, service permission policy;
- permission administration: `permission_grant`, `permission_revoke`,
  `permission_set`, `permission_tree`;
- Yellow Pages/platform: `uniqueId`, `entity`, `vhost`, `get_hub`, sessions;
- excluded capabilities: `filecap`, `disk_usage`, trash, changelog, search,
  acknowledgement, Team, DMZ, Finder, and Window Manager.
