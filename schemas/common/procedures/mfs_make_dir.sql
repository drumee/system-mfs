DELIMITER $
DROP PROCEDURE IF EXISTS `mfs_make_dir`$
CREATE PROCEDURE `mfs_make_dir`(IN _pid VARCHAR(16),IN _name VARCHAR(128),IN _owner_id VARCHAR(16))
BEGIN
  DECLARE _existing VARCHAR(16) DEFAULT NULL;
  SELECT id INTO _existing FROM media WHERE parent_id=_pid AND user_filename=_name AND extension='' AND status='active' LIMIT 1;
  IF _existing IS NULL THEN
    CALL mfs_create_node(JSON_OBJECT('owner_id',_owner_id,'pid',_pid,'filename',_name,'category','folder','mimetype','folder','filesize',0),JSON_OBJECT());
  ELSE
    CALL mfs_node_attr(_existing);
  END IF;
END$
DELIMITER ;
