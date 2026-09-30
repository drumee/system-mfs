DELIMITER $
DROP FUNCTION IF EXISTS `user_expiry`$
CREATE FUNCTION `user_expiry`(_uid VARCHAR(512) CHARACTER SET ascii,_rid VARCHAR(16) CHARACTER SET ascii)
RETURNS INT DETERMINISTIC
BEGIN
  DECLARE _expiry INT DEFAULT NULL;
  SET _uid=IF(_uid IN ('*','ffffffffffffffff','nobody'),'*',_uid);
  SELECT expiry_time INTO _expiry FROM permission WHERE entity_id=_uid AND resource_id=_rid LIMIT 1;
  IF _expiry IS NULL THEN SELECT expiry_time INTO _expiry FROM permission WHERE entity_id=_uid AND resource_id='*' LIMIT 1; END IF;
  RETURN IFNULL(_expiry,0);
END$
DELIMITER ;
