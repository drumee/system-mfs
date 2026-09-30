DELIMITER $
DROP PROCEDURE IF EXISTS `mfs_rename`$
CREATE PROCEDURE `mfs_rename`(IN _nid VARCHAR(16),IN _new_name VARCHAR(128))
BEGIN
  DECLARE _old_path VARCHAR(1000);
  DECLARE _parent_path VARCHAR(1000);
  DECLARE _new_path VARCHAR(1000);
  DECLARE _ext VARCHAR(100);
  DECLARE _category VARCHAR(16);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  SELECT file_path,parent_path,extension,category INTO _old_path,_parent_path,_ext,_category FROM media WHERE id=_nid AND status='active' LIMIT 1;
  IF _old_path IS NULL OR _category='root' THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644,MESSAGE_TEXT='MFS_NODE_INVALID'; END IF;
  SET _new_path=mfs_clean_path(CONCAT(_parent_path,'/',_new_name,IF(_ext='', '', CONCAT('.',_ext))));
  START TRANSACTION;
  UPDATE media SET file_path=CONCAT(_new_path,SUBSTRING(file_path,LENGTH(_old_path)+1)),parent_path=CASE WHEN parent_path=_old_path THEN _new_path ELSE CONCAT(_new_path,SUBSTRING(parent_path,LENGTH(_old_path)+1)) END WHERE file_path LIKE CONCAT(_old_path,'/%');
  UPDATE media SET user_filename=_new_name,file_path=_new_path,publish_time=UNIX_TIMESTAMP() WHERE id=_nid;
  COMMIT;
  CALL mfs_node_attr(_nid);
END$
DELIMITER ;
