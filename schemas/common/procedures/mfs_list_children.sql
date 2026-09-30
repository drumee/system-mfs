DELIMITER $
DROP PROCEDURE IF EXISTS `mfs_list_children`$
CREATE PROCEDURE `mfs_list_children`(IN _parent_id VARCHAR(16),IN _offset INT,IN _limit INT,IN _sort VARCHAR(16))
BEGIN
  SELECT id,id AS nid,parent_id,parent_id AS pid,file_path AS filepath,user_filename AS filename,extension AS ext,category AS filetype,mimetype,filesize,geometry,upload_time AS ctime,publish_time AS mtime,status,rank,metadata
  FROM media WHERE parent_id=_parent_id AND status='active'
  ORDER BY CASE WHEN _sort='mtime' THEN publish_time END DESC,CASE WHEN _sort='size' THEN filesize END DESC,CASE WHEN _sort='name' THEN user_filename END,id
  LIMIT _limit OFFSET _offset;
END$
DELIMITER ;
