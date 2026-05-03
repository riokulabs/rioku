ALTER TABLE applications DROP FOREIGN KEY fk_applications_owner;
ALTER TABLE applications DROP FOREIGN KEY fk_applications_tenant;
DROP TABLE IF EXISTS applications;
