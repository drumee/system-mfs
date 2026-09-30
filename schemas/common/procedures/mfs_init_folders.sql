DELIMITER $
DROP PROCEDURE IF EXISTS `mfs_init_folders`$
CREATE PROCEDURE `mfs_init_folders`(IN _folders JSON,IN _owner_id VARCHAR(16))
BEGIN
  DECLARE _i INT DEFAULT 0;
  DECLARE _home_id VARCHAR(16);
  DECLARE _name VARCHAR(128);
  SELECT id INTO _home_id FROM media WHERE parent_id='0' LIMIT 1;
  WHILE _i<JSON_LENGTH(_folders) DO
    SET _name=JSON_UNQUOTE(JSON_EXTRACT(_folders,CONCAT('$[',_i,']')));
    CALL mfs_make_dir(_home_id,_name,_owner_id);
    SET _i=_i+1;
  END WHILE;
END$
DELIMITER ;
