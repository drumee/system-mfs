DELIMITER $
DROP PROCEDURE IF EXISTS `mfs_enumerate_tree`$
CREATE PROCEDURE `mfs_enumerate_tree`(IN _nid VARCHAR(16))
BEGIN
  WITH RECURSIVE tree AS (
    SELECT id,parent_id,file_path,user_filename,extension,category,mimetype,filesize,upload_time,publish_time,status,rank,metadata,0 depth FROM media WHERE id=_nid AND status='active'
    UNION ALL
    SELECT m.id,m.parent_id,m.file_path,m.user_filename,m.extension,m.category,m.mimetype,m.filesize,m.upload_time,m.publish_time,m.status,m.rank,m.metadata,t.depth+1 FROM media m INNER JOIN tree t ON m.parent_id=t.id WHERE m.status='active'
  )
  SELECT id,id AS nid,parent_id,file_path AS filepath,user_filename AS filename,extension AS ext,category AS filetype,mimetype,filesize,upload_time AS ctime,publish_time AS mtime,status,rank,metadata FROM tree ORDER BY depth,filepath;
END$
DELIMITER ;
