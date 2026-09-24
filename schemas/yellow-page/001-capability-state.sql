-- system-mfs owns this explicit lifecycle state. Platform identity locators are
-- deliberately not used as evidence that MFS is installed or provisioned.
CREATE TABLE IF NOT EXISTS `system_mfs_installation` (
  `singleton` tinyint unsigned NOT NULL,
  `schema_version` varchar(64) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `installed_at` int unsigned NOT NULL,
  PRIMARY KEY (`singleton`),
  CONSTRAINT `system_mfs_installation_singleton` CHECK (`singleton` = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `system_mfs_provisioning` (
  `organisation_id` int unsigned NOT NULL,
  `principal_id` varchar(16) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `database_name` varchar(64) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `root_id` varchar(16) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL,
  `schema_version` varchar(64) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `status` enum('provisioning','provisioned','failed') NOT NULL,
  `error_code` varchar(80) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL,
  `ctime` int unsigned NOT NULL,
  `mtime` int unsigned NOT NULL,
  PRIMARY KEY (`organisation_id`,`principal_id`),
  UNIQUE KEY `database_name` (`database_name`),
  UNIQUE KEY `root_id` (`root_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `system_mfs_installation` (`singleton`,`schema_version`,`installed_at`)
VALUES (1,'phase4.6b-system-mfs-1',UNIX_TIMESTAMP())
ON DUPLICATE KEY UPDATE `installed_at`=`installed_at`;
