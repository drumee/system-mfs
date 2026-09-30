CREATE TABLE IF NOT EXISTS `system_mfs_installation` (
  `singleton` tinyint unsigned NOT NULL,
  `schema_version` varchar(64) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `installed_at` int unsigned NOT NULL,
  PRIMARY KEY (`singleton`),
  CONSTRAINT `system_mfs_installation_singleton` CHECK (`singleton` = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `system_mfs_installation` (`singleton`,`schema_version`,`installed_at`)
VALUES (1,'phase4.8-system-mfs-2',UNIX_TIMESTAMP())
ON DUPLICATE KEY UPDATE `installed_at`=`installed_at`;
