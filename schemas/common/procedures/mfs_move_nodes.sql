DELIMITER $
DROP PROCEDURE IF EXISTS `mfs_move_nodes`$
CREATE PROCEDURE `mfs_move_nodes`(IN _nodes JSON,IN _destination VARCHAR(16))
BEGIN
  DECLARE _i INT DEFAULT 0;
  DECLARE _nid VARCHAR(16);
  DECLARE _old_path VARCHAR(1000);
  DECLARE _dest_path VARCHAR(1000);
  DECLARE _new_path VARCHAR(1000);
  DECLARE _category VARCHAR(16);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  SELECT file_path INTO _dest_path FROM media WHERE id=_destination AND category IN('root','folder') AND status='active' LIMIT 1;
  IF _dest_path IS NULL THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644,MESSAGE_TEXT='MFS_DESTINATION_INVALID'; END IF;
  START TRANSACTION;
  WHILE _i<JSON_LENGTH(_nodes) DO
    SET _nid=JSON_UNQUOTE(JSON_EXTRACT(_nodes,CONCAT('$[',_i,']')));
    SELECT file_path,category INTO _old_path,_category FROM media WHERE id=_nid AND status='active' LIMIT 1;
    IF _old_path IS NULL OR _category='root' THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644,MESSAGE_TEXT='MFS_NODE_INVALID'; END IF;
    IF _dest_path=_old_path OR _dest_path LIKE CONCAT(_old_path,'/%') THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644,MESSAGE_TEXT='MFS_MOVE_CYCLE'; END IF;
    SET _new_path=mfs_clean_path(CONCAT(_dest_path,'/',SUBSTRING_INDEX(_old_path,'/',-1)));
    UPDATE media SET file_path=CONCAT(_new_path,SUBSTRING(file_path,LENGTH(_old_path)+1)),parent_path=CASE WHEN parent_path=_old_path THEN _new_path ELSE CONCAT(_new_path,SUBSTRING(parent_path,LENGTH(_old_path)+1)) END WHERE file_path LIKE CONCAT(_old_path,'/%');
    UPDATE media SET parent_id=_destination,parent_path=_dest_path,file_path=_new_path,publish_time=UNIX_TIMESTAMP() WHERE id=_nid;
    SET _i=_i+1;
  END WHILE;
  COMMIT;
  SELECT id,id AS nid,parent_id,parent_id AS pid,file_path AS filepath,user_filename AS filename,extension AS ext,category AS filetype,mimetype,filesize,upload_time AS ctime,publish_time AS mtime,status,rank,metadata FROM media WHERE JSON_CONTAINS(_nodes,JSON_QUOTE(id),'$');
END$
DELIMITER ;
