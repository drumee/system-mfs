-- {{DATABASE}} is replaced with a validated module-owned identifier by the
-- system-mfs provisioner. This is the minimal historical folder namespace.
CREATE DATABASE IF NOT EXISTS `{{DATABASE}}` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE `{{DATABASE}}`;

CREATE TABLE IF NOT EXISTS `media` (
  `sys_id` int unsigned NOT NULL AUTO_INCREMENT,
  `id` varchar(16) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL,
  `origin_id` varchar(16) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL,
  `owner_id` varchar(16) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL,
  `host_id` varchar(16) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL,
  `file_path` varchar(1000) DEFAULT NULL,
  `user_filename` varchar(128) DEFAULT NULL,
  `parent_id` varchar(16) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL,
  `parent_path` varchar(1024) NOT NULL,
  `extension` varchar(100) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL,
  `mimetype` varchar(100) NOT NULL,
  `category` varchar(16) NOT NULL DEFAULT 'other',
  `isalink` tinyint unsigned NOT NULL DEFAULT 0,
  `filesize` bigint unsigned DEFAULT 0,
  `geometry` varchar(200) NOT NULL DEFAULT '0x0',
  `publish_time` int unsigned NOT NULL DEFAULT 0,
  `upload_time` int unsigned NOT NULL DEFAULT 0,
  `last_download` int unsigned NOT NULL DEFAULT 0,
  `download_count` mediumint unsigned NOT NULL DEFAULT 0,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT '{}' CHECK (json_valid(`metadata`)),
  `caption` varchar(1024) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `approval` enum('submitted','verified','validated','draft','online','offline') DEFAULT 'draft',
  `rank` int NOT NULL DEFAULT 0,
  PRIMARY KEY (`sys_id`),
  UNIQUE KEY `id` (`id`),
  UNIQUE KEY `filepath` (`file_path`),
  UNIQUE KEY `path` (`parent_id`,`user_filename`,`extension`),
  KEY `parent_id` (`parent_id`),
  KEY `category` (`category`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;

CREATE TABLE IF NOT EXISTS `permission` (
  `sys_id` int unsigned NOT NULL AUTO_INCREMENT,
  `resource_id` varchar(16) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL,
  `entity_id` varchar(512) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL,
  `message` mediumtext DEFAULT NULL,
  `expiry_time` int NOT NULL DEFAULT 0,
  `ctime` int DEFAULT NULL,
  `utime` int DEFAULT NULL,
  `permission` tinyint unsigned NOT NULL,
  `assign_via` enum('system','link','share','no_traversal','root') DEFAULT NULL,
  PRIMARY KEY (`sys_id`),
  UNIQUE KEY `pkey` (`resource_id`,`entity_id`),
  KEY `entity_id` (`entity_id`),
  KEY `permission` (`permission`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;

DELIMITER $
DROP FUNCTION IF EXISTS `mfs_clean_path`$
CREATE FUNCTION `mfs_clean_path`(_path TEXT) RETURNS TEXT DETERMINISTIC
BEGIN
  RETURN IF(_path='/', '/', REGEXP_REPLACE(CONCAT('/', TRIM(BOTH '/' FROM _path)), '/+', '/'));
END$

DROP PROCEDURE IF EXISTS `mfs_node_attr`$
CREATE PROCEDURE `mfs_node_attr`(IN _node VARCHAR(1000))
BEGIN
  IF _node REGEXP '^/' THEN
    SELECT id INTO _node FROM media WHERE file_path=mfs_clean_path(_node) LIMIT 1;
  END IF;
  SELECT id AS nid, id, parent_id AS pid, parent_id, owner_id, origin_id,
    file_path, file_path AS filepath, user_filename AS filename,
    extension AS ext, category AS ftype, category AS filetype, mimetype,
    filesize, geometry, upload_time AS ctime, publish_time AS mtime,
    status, rank, metadata
  FROM media WHERE id=_node LIMIT 1;
END$

DROP PROCEDURE IF EXISTS `mfs_make_dir`$
CREATE PROCEDURE `mfs_make_dir`(IN _pid TEXT, IN _rel_path JSON, IN _show_results BOOLEAN)
BEGIN
  DECLARE _idx int DEFAULT 0;
  DECLARE _file_name varchar(128);
  DECLARE _file_path text DEFAULT NULL;
  DECLARE _parent_path text DEFAULT '/';
  DECLARE _parent_id varchar(16);
  DECLARE _nid varchar(16) DEFAULT NULL;
  DECLARE _home_id varchar(16);
  DECLARE _owner_id varchar(16);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  START TRANSACTION;
  SELECT id, owner_id INTO _home_id, _owner_id FROM media WHERE parent_id='0' LIMIT 1;
  IF _pid REGEXP '^/' THEN
    SELECT id, file_path INTO _pid, _file_path FROM media WHERE file_path=mfs_clean_path(_pid) LIMIT 1;
  END IF;
  IF _file_path IS NULL THEN
    SELECT file_path INTO _file_path FROM media WHERE id=_pid LIMIT 1;
  END IF;
  IF _file_path IS NULL OR _file_path='/' THEN
    SELECT _home_id, '', '/' INTO _parent_id, _file_path, _parent_path;
  ELSE
    SELECT _pid, _file_path INTO _parent_id, _parent_path;
  END IF;
  IF JSON_LENGTH(_rel_path) IS NULL THEN SET _rel_path=JSON_ARRAY(_rel_path); END IF;
  WHILE _idx < JSON_LENGTH(_rel_path) DO
    SELECT JSON_VALUE(_rel_path, CONCAT('$[', _idx, ']')) INTO _file_name;
    SET _idx=_idx+1;
    IF _file_name IS NOT NULL AND TRIM(BOTH '/' FROM _file_name)<>'' THEN
      SET _file_name=TRIM(BOTH '/' FROM _file_name);
      SET _parent_path=_file_path;
      SET _file_path=mfs_clean_path(CONCAT(_file_path, '/', _file_name));
      SET _nid=NULL;
      SELECT id INTO _nid FROM media WHERE file_path=_file_path LIMIT 1;
      IF _nid IS NULL THEN
        SELECT yp.uniqueId() INTO _nid;
        INSERT INTO media (id,origin_id,owner_id,file_path,user_filename,parent_id,parent_path,extension,mimetype,category,isalink,filesize,geometry,publish_time,upload_time,status,rank)
        VALUES (_nid,_owner_id,_owner_id,_file_path,_file_name,_parent_id,_parent_path,'','folder','folder',0,0,'0x0',UNIX_TIMESTAMP(),UNIX_TIMESTAMP(),'active',0);
      END IF;
      SET _parent_id=_nid;
    END IF;
  END WHILE;
  COMMIT;
  IF IFNULL(_show_results,1)=1 THEN CALL mfs_node_attr(_nid); END IF;
END$

DROP PROCEDURE IF EXISTS `mfs_init_folders`$
CREATE PROCEDURE `mfs_init_folders`(IN _folders JSON, IN _clear_existing BOOLEAN)
BEGIN
  DECLARE _i int DEFAULT 0;
  DECLARE _home_id varchar(16);
  DECLARE _path text;
  SELECT id INTO _home_id FROM media WHERE parent_id='0' LIMIT 1;
  IF _clear_existing THEN DELETE FROM media WHERE parent_id=_home_id AND status='active'; END IF;
  WHILE _i < JSON_LENGTH(_folders) DO
    SELECT JSON_VALUE(_folders, CONCAT('$[',_i,'].path')) INTO _path;
    CALL mfs_make_dir(_home_id, JSON_ARRAY(_path), 0);
    SET _i=_i+1;
  END WHILE;
END$

DROP PROCEDURE IF EXISTS `mfs_show_node_by`$
CREATE PROCEDURE `mfs_show_node_by`(IN _node_id varchar(16), IN _uid varchar(16), IN _params JSON)
BEGIN
  IF _node_id IS NULL OR _node_id='0' THEN SELECT id INTO _node_id FROM media WHERE parent_id='0' LIMIT 1; END IF;
  SELECT m.id AS nid, m.parent_id AS pid, m.parent_id, m.file_path AS filepath,
    m.file_path AS ownpath, m.owner_id, m.status, m.user_filename AS filename,
    m.filesize, m.extension AS ext, m.category AS ftype, m.mimetype,
    m.metadata, m.geometry, m.upload_time AS ctime, m.publish_time AS mtime,
    m.rank, COALESCE(p.permission,0) AS privilege
  FROM media m
  LEFT JOIN permission p ON p.resource_id IN (m.id,'*') AND p.entity_id=_uid
  WHERE m.parent_id=_node_id AND m.status NOT IN ('hidden','deleted')
  ORDER BY m.rank, m.user_filename, m.id;
END$
DELIMITER ;
