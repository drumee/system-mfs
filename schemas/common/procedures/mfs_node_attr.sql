DELIMITER $
DROP PROCEDURE IF EXISTS `mfs_node_attr`$
CREATE PROCEDURE `mfs_node_attr`(IN _node VARCHAR(1000))
BEGIN
  IF _node REGEXP '^/' THEN SELECT id INTO _node FROM media WHERE file_path=mfs_clean_path(_node) LIMIT 1; END IF;
  SELECT id,id AS nid,parent_id,parent_id AS pid,owner_id,origin_id,file_path,file_path AS filepath,user_filename AS filename,extension AS ext,category AS filetype,mimetype,filesize,geometry,upload_time AS ctime,publish_time AS mtime,status,rank,metadata FROM media WHERE id=_node AND status='active' LIMIT 1;
END$
DELIMITER ;
