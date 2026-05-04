ALTER TABLE subscriptions DROP FOREIGN KEY fk_subscriptions_application;
ALTER TABLE subscriptions DROP FOREIGN KEY fk_subscriptions_plan;
ALTER TABLE subscriptions DROP FOREIGN KEY fk_subscriptions_tenant;
DROP TABLE IF EXISTS subscriptions;
