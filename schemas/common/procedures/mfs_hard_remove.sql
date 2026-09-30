DELIMITER $
DROP PROCEDURE IF EXISTS `mfs_hard_remove`$
CREATE PROCEDURE `mfs_hard_remove`(IN _nid VARCHAR(16))
BEGIN
  DECLARE _category VARCHAR(16);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; DROP TEMPORARY TABLE IF EXISTS __mfs_removed; RESIGNAL; END;
  SELECT category INTO _category FROM media WHERE id=_nid AND status='active' LIMIT 1;
  IF _category IS NULL OR _category='root' THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644,MESSAGE_TEXT='MFS_NODE_INVALID'; END IF;
  DROP TEMPORARY TABLE IF EXISTS __mfs_removed;
  CREATE TEMPORARY TABLE __mfs_removed (nid VARCHAR(16) CHARACTER SET ascii PRIMARY KEY,parent_id VARCHAR(16) CHARACTER SET ascii,metadata LONGTEXT,depth INT);
  INSERT INTO __mfs_removed
  WITH RECURSIVE tree AS (SELECT id,parent_id,metadata,0 depth FROM media WHERE id=_nid UNION ALL SELECT m.id,m.parent_id,m.metadata,t.depth+1 FROM media m INNER JOIN tree t ON m.parent_id=t.id)
  SELECT id,parent_id,metadata,depth FROM tree;
  START TRANSACTION;
  DELETE FROM permission WHERE resource_id IN (SELECT nid FROM __mfs_removed);
  DELETE FROM media WHERE id IN (SELECT nid FROM __mfs_removed);
  COMMIT;
  SELECT nid,parent_id,metadata FROM __mfs_removed ORDER BY depth DESC;
  DROP TEMPORARY TABLE __mfs_removed;
END$
DELIMITER ;
