DELIMITER $
DROP FUNCTION IF EXISTS `parent_permission`$
CREATE FUNCTION `parent_permission`(_uid VARCHAR(16) CHARACTER SET ascii,_node_id VARCHAR(16) CHARACTER SET ascii)
RETURNS TINYINT(2) DETERMINISTIC
BEGIN
  DECLARE _perm TINYINT(4) DEFAULT 0;
  WITH RECURSIVE parent_media AS (
    SELECT m.id,m.parent_id,CASE WHEN p.assign_via='root' THEN 0 ELSE IFNULL(p.permission,0) END permission,p.assign_via
      FROM media m LEFT JOIN permission p ON p.resource_id=m.parent_id AND p.entity_id IN(_uid,'*') WHERE m.id=_node_id
    UNION ALL
    SELECT m.id,m.parent_id,CASE WHEN p.assign_via='root' THEN 0 ELSE IFNULL(p.permission,0) END permission,p.assign_via
      FROM media m LEFT JOIN permission p ON p.resource_id=m.parent_id AND p.entity_id IN(_uid,'*')
      INNER JOIN parent_media t ON m.id=t.parent_id AND m.parent_id<>'0' AND t.permission=0 AND IFNULL(t.assign_via,'') NOT IN ('no_traversal','root')
  )
  SELECT MAX(permission) INTO _perm FROM parent_media WHERE permission<>0;
  RETURN IFNULL(_perm,0);
END$
DELIMITER ;
