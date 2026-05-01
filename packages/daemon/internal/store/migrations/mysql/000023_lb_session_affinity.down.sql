-- 000023_lb_session_affinity.down.sql

ALTER TABLE services DROP COLUMN lb_cookie_name;
ALTER TABLE services DROP COLUMN lb_header_name;
