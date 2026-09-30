CREATE TABLE IF NOT EXISTS `system_mfs_provisioning` (
  `hub_id` varchar(16) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `shard_type` enum('hub','drumate') NOT NULL,
  `database_name` varchar(64) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `root_id` varchar(16) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL,
  `schema_version` varchar(64) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `status` enum('provisioning','provisioned','failed') NOT NULL,
  `error_code` varchar(80) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL,
  `ctime` int unsigned NOT NULL,
  `mtime` int unsigned NOT NULL,
  PRIMARY KEY (`hub_id`),
  UNIQUE KEY `database_name` (`database_name`),
  UNIQUE KEY `root_id` (`root_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
