-- 000023_lb_session_affinity.up.sql
--
-- Adds session-affinity / hash-based load-balancing fields to services
-- (#71). The new lb_policy values 6 (cookie), 7 (uri_hash), 8 (header)
-- consume these columns; existing rows default both to empty strings
-- so the round-robin / random / least-conn / ip-hash / weighted_rr
-- policies stay unaffected.

ALTER TABLE services ADD COLUMN lb_cookie_name TEXT NOT NULL DEFAULT '';
ALTER TABLE services ADD COLUMN lb_header_name TEXT NOT NULL DEFAULT '';

INSERT INTO schema_versions (version, dirty) VALUES (23, FALSE)
    ON CONFLICT (version) DO NOTHING;
