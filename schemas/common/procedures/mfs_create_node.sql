DELIMITER $
DROP PROCEDURE IF EXISTS `mfs_create_node`$
CREATE PROCEDURE `mfs_create_node`(IN _attributes JSON,IN _metadata JSON)
BEGIN
  DECLARE _nid VARCHAR(16) CHARACTER SET ascii;
  DECLARE _owner_id VARCHAR(16) CHARACTER SET ascii;
  DECLARE _pid VARCHAR(16) CHARACTER SET ascii;
  DECLARE _fname VARCHAR(128);
  DECLARE _category VARCHAR(16);
  DECLARE _ext VARCHAR(100);
  DECLARE _mimetype VARCHAR(100);
  DECLARE _filesize BIGINT UNSIGNED;
  DECLARE _parent_path VARCHAR(1000);
  DECLARE _filepath VARCHAR(1000);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  SET _nid=JSON_UNQUOTE(JSON_EXTRACT(_attributes,'$.nid'));
  SET _owner_id=JSON_UNQUOTE(JSON_EXTRACT(_attributes,'$.owner_id'));
  SET _pid=JSON_UNQUOTE(JSON_EXTRACT(_attributes,'$.pid'));
  SET _fname=IFNULL(JSON_UNQUOTE(JSON_EXTRACT(_attributes,'$.filename')),'');
  SET _category=IFNULL(JSON_UNQUOTE(JSON_EXTRACT(_attributes,'$.category')),'other');
  SET _ext=IFNULL(JSON_UNQUOTE(JSON_EXTRACT(_attributes,'$.ext')),'');
  SET _mimetype=IFNULL(JSON_UNQUOTE(JSON_EXTRACT(_attributes,'$.mimetype')),'application/octet-stream');
  SET _filesize=IFNULL(JSON_VALUE(_attributes,'$.filesize'),0);
  IF _nid IS NULL OR _nid='' THEN SET _nid=yp.uniqueId(); END IF;
  START TRANSACTION;
  IF _category='root' THEN
    SET _pid='0'; SET _parent_path='/'; SET _filepath='/'; SET _fname=''; SET _ext='';
  ELSE
    SELECT file_path INTO _parent_path FROM media WHERE id=_pid AND category IN('root','folder') AND status='active' LIMIT 1;
    IF _parent_path IS NULL THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644,MESSAGE_TEXT='MFS_DESTINATION_INVALID'; END IF;
    SET _filepath=mfs_clean_path(CONCAT(_parent_path,'/',_fname,IF(_ext='', '', CONCAT('.',_ext))));
  END IF;
  INSERT INTO media (id,origin_id,owner_id,file_path,user_filename,parent_id,parent_path,extension,mimetype,category,filesize,geometry,publish_time,upload_time,metadata,status,rank)
  VALUES (_nid,_owner_id,_owner_id,_filepath,_fname,_pid,_parent_path,_ext,_mimetype,_category,_filesize,'0x0',UNIX_TIMESTAMP(),UNIX_TIMESTAMP(),IFNULL(_metadata,JSON_OBJECT()),'active',0);
  COMMIT;
  SELECT id,id AS nid,parent_id,parent_id AS pid,user_filename AS filename,category AS filetype,extension AS ext,mimetype,filesize,file_path AS filepath,upload_time AS ctime,publish_time AS mtime,status,rank,metadata FROM media WHERE id=_nid;
END$
DELIMITER ;
