# @drumee/system-mfs

This standalone CommonJS package owns the minimal Drumee MFS folder namespace
validated in Phase 4.6B. It is a system/kernel module, not intrinsic runtime,
Finder, a collaboration suite or a platform identity provisioner.

`install()` installs only the module lifecycle registry. `provision(context)`
creates one explicitly requested per-principal MFS database. Both have separate
read-only validation operations, and `capabilityAvailable(context)` reports
whether the selected context is genuinely ready.

The provisioning database adapter may declare `runtime_user`; provisioning then
grants that configured account only the DML and routine execution privileges
needed on the new context database. No account name is hardcoded in the module.

The required context is `{ organisation_id, principal_id }`. The principal must
already exist in that organisation. The module never provisions platform
identities and never enumerates nobody, guest, system or all Drumates.

Provisioning retains the historical `media` hierarchy, root owner permission,
`mfs_make_dir`, `mfs_init_folders`, node resolution and child listing. It does
not include Hub, Team, Finder, DMZ, trash, notification acknowledgement,
changelog decoration or physical file storage.

The module-owned `system_mfs_provisioning` table is authoritative. Phase 4.6A
`entity.db_name`, `entity.home_dir` and `entity.home_id` values remain logical
identity placeholders and are neither changed nor treated as MFS evidence.

## Runtime and SQL contracts

The package has no runtime npm dependencies. Callers provide a parameterized
database adapter with `await_query` or `query`; provisioning additionally
requires `executeScript`. An optional `runtime_user` receives only context
database DML and routine execution grants.

The Yellow Page database must already provide `uniqueId()`, `entity`,
`drumate`, and `organisation`. Platform bootstrap owns those contracts and the
principal identities. This package owns only:

```text
Yellow Page:
    system_mfs_installation
    system_mfs_provisioning

per-context database:
    media
    permission
    mfs_clean_path
    mfs_node_attr
    mfs_make_dir
    mfs_init_folders
    mfs_show_node_by
```

## Lifecycle states

`not-installed`, `installed`, `provisioning`, `provisioned`, `partial`,
`conflicting`, and `failed` remain explicit states. Capability availability is
derived from module-owned lifecycle state and validated namespace objects,
never from `entity.db_name`, `entity.home_dir`, or `entity.home_id`.

## Release status

Version `0.1.0-alpha.1` is the first standalone extraction candidate. The
package is release-ready for the npm `next` tag but R2 does not authorize
publication.
