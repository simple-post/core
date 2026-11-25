\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT set_config('simplepost.pilot_email', :'pilot_email', true) IS NOT NULL AS email_supplied;
LOCK TABLE user_feature IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE
  owner_id text;
BEGIN
  SELECT id INTO STRICT owner_id FROM "user"
    WHERE lower(email) = lower(current_setting('simplepost.pilot_email')) AND "emailVerified"
    FOR SHARE;
  IF EXISTS (SELECT 1 FROM user_feature WHERE feature = 'TEAM_WORKSPACES' AND "userId" <> owner_id) THEN
    RAISE EXCEPTION 'Another account already has the workspace pilot grant';
  END IF;
  INSERT INTO user_feature ("userId", feature) VALUES (owner_id, 'TEAM_WORKSPACES')
    ON CONFLICT ("userId", feature) DO NOTHING;
END $$;
COMMIT;
