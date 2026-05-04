ALTER TABLE waf_denials DROP FOREIGN KEY fk_waf_denials_route;
ALTER TABLE waf_denials DROP FOREIGN KEY fk_waf_denials_tenant;
DROP TABLE IF EXISTS waf_denials;
ALTER TABLE route_waf_configs DROP FOREIGN KEY fk_route_waf_tenant;
ALTER TABLE route_waf_configs DROP FOREIGN KEY fk_route_waf_route;
DROP TABLE IF EXISTS route_waf_configs;
