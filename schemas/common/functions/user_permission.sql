DELIMITER $
DROP FUNCTION IF EXISTS `user_permission`$
CREATE FUNCTION `user_permission`(_uid VARCHAR(512) CHARACTER SET ascii,_rid VARCHAR(16) CHARACTER SET ascii)
RETURNS TINYINT(2) DETERMINISTIC
BEGIN
  DECLARE _perm TINYINT(2) DEFAULT 0;
  DECLARE _category VARCHAR(60);
  SELECT category INTO _category FROM media WHERE id=_rid;
  SET _uid=IF(_uid IN ('*','ffffffffffffffff','nobody'),'*',_uid);
  IF _category='hub' THEN
    SELECT IFNULL(MAX(permission),0) INTO _perm FROM permission WHERE resource_id=_rid AND entity_id=_uid;
  ELSE
    SELECT IFNULL(MAX(permission),0) INTO _perm FROM permission WHERE entity_id=_uid AND _uid<>'*' AND resource_id='*';
    IF _perm=0 THEN SELECT IFNULL(MAX(permission),0) INTO _perm FROM permission WHERE entity_id IN(_uid,'*','ffffffffffffffff','nobody') AND resource_id=_rid; END IF;
    IF _perm=0 THEN SET _perm=parent_permission(_uid,_rid); END IF;
    IF _perm=0 THEN SELECT IFNULL(MAX(permission),0) INTO _perm FROM permission WHERE entity_id IN('*','ffffffffffffffff','nobody') AND resource_id IN('*',_rid); END IF;
  END IF;
  RETURN IFNULL(_perm,0);
END$
DELIMITER ;
