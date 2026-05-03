ALTER TABLE route_oas_configs DROP FOREIGN KEY fk_route_oas_tenant;
ALTER TABLE route_oas_configs DROP FOREIGN KEY fk_route_oas_route;
DROP TABLE IF EXISTS route_oas_configs;
