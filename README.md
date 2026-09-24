# Phase 4.6B system-mfs

This private transitional CommonJS module owns the minimal Drumee MFS folder
namespace. It is not a public package, final repository boundary or publication
candidate.

`install()` installs only the module lifecycle registry. `provision(context)`
creates one explicitly requested per-principal MFS database. Both have separate
read-only validation operations, and `capabilityAvailable(context)` reports
whether the selected context is genuinely ready.

The provisioning database adapter may declare `runtimeUser`; provisioning then
grants that configured account only the DML and routine execution privileges
needed on the new context database. No account name is hardcoded in the module.

The required context is `{ organisationId, principalId }`. The principal must
already exist in that organisation. The module never provisions platform
identities and never enumerates nobody, guest, system or all Drumates.

Provisioning retains the historical `media` hierarchy, root owner permission,
`mfs_make_dir`, `mfs_init_folders`, node resolution and child listing. It does
not include Hub, Team, Finder, DMZ, trash, notification acknowledgement,
changelog decoration or physical file storage.

The module-owned `system_mfs_provisioning` table is authoritative. Phase 4.6A
`entity.db_name`, `entity.home_dir` and `entity.home_id` values remain logical
identity placeholders and are neither changed nor treated as MFS evidence.
