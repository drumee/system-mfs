DELIMITER $
DROP PROCEDURE IF EXISTS `mfs_show_node_by`$
CREATE PROCEDURE `mfs_show_node_by`(IN _node_id VARCHAR(16),IN _uid VARCHAR(16),IN _params JSON)
BEGIN
  IF _node_id IS NULL OR _node_id='0' THEN SELECT id INTO _node_id FROM media WHERE parent_id='0' LIMIT 1; END IF;
  SELECT id,id AS nid,parent_id,parent_id AS pid,file_path AS filepath,user_filename AS filename,extension AS ext,category AS filetype,mimetype,filesize,geometry,upload_time AS ctime,publish_time AS mtime,status,rank,metadata,user_permission(_uid,id) AS privilege FROM media WHERE parent_id=_node_id AND status='active' ORDER BY rank,user_filename,id;
END$
DELIMITER ;
