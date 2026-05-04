ALTER TABLE virtual_keys DROP FOREIGN KEY fk_virtual_keys_creator;
ALTER TABLE virtual_keys DROP FOREIGN KEY fk_virtual_keys_tenant;
DROP TABLE IF EXISTS virtual_keys;
