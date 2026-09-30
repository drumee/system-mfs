# @drumee/system-mfs

This standalone CommonJS package owns the generic Drumee MFS capability. It is
a system/kernel module, not intrinsic server runtime, Finder, Team policy, or a
platform identity provisioner.

`install()` installs module lifecycle state in Yellow Pages. `provision()`
installs and validates MFS SQL in an existing Yellow Pages entity shard. The
public shard identity is always `{ hub_id, nid }`; physical `db_name`,
`home_dir`, database hosts, filesystem hosts, and content references remain
backend-internal.

Provisioning accepts `{ hub_id }` or a trusted `{ host }`, resolves the entity
descriptor, and supports `hub` and `drumate` shards. It never creates an
`mfs_<principal_id>` database. Common SQL is shared by both shard classes;
class overlays are explicit and currently empty.

Every SQL object has its own source file and its own deterministic manifest
entry. Shard-local tree operations are procedure-driven. The package owns:

```text
Yellow Pages lifecycle tables:
    system_mfs_installation
    system_mfs_provisioning

common shard tables:
    media
    permission

MFS permission functions:
    parent_permission
    user_permission
    user_expiry

MFS tree procedures:
    mfs_create_node
    mfs_node_attr
    mfs_make_dir
    mfs_init_folders
    mfs_show_node_by
    mfs_list_children
    mfs_rename
    mfs_hard_remove
    mfs_move_nodes
    mfs_enumerate_tree
```

Service-required permissions and the final GRANTED/DENIED decision do not live
here. Server ACL supplies a trusted Session uid and calls the MFS-specific
`user_permission()` primitive. `MfsFilesystem` runs only after that service ACL
grant and retains structural and transactional filesystem checks.

`LocalContentStore` is the optional canonical-content adapter. `commitFile()`
receives only an opaque, complete staged artifact and adopts it into canonical
storage. HTTP parsing, upload sessions, temporary chunks, progress, archives,
WebSocket routing, Finder, trash, changelog, search, and quota policy remain
outside this package.

The package has no runtime npm dependencies. Callers provide a parameterized
database adapter with `await_query` or `query`; provisioning additionally
requires `executeScript`. Yellow Pages must provide `uniqueId()`, `entity`, and
`vhost` plus the existing assigned shard databases.

## Release status

Version `0.1.0-alpha.1` remains the only npm release. The Phase 4.8 Git
realignment is intentionally unpublished; no registry tag or package version
is changed by this work.
