CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  user_count int;
  uname text;
  first_user boolean;
BEGIN
  SELECT COUNT(*) INTO user_count FROM profiles;
  first_user := user_count = 0;

  uname := COALESCE(
    (NEW.raw_user_meta_data->>'username')::text,
    split_part(NEW.email, '@', 1),
    'user_' || replace(NEW.id::text, '-', '')
  );

  INSERT INTO public.profiles (id, username, nickname, openid, role, is_admin)
  VALUES (
    NEW.id,
    uname,
    COALESCE((NEW.raw_user_meta_data->>'nickname')::text, uname),
    COALESCE((NEW.raw_user_meta_data->>'openid')::text, NULL),
    CASE WHEN first_user THEN 'admin'::user_role ELSE 'user'::user_role END,
    first_user
  )
  ON CONFLICT (id) DO UPDATE SET
    username = COALESCE(profiles.username, EXCLUDED.username),
    nickname = COALESCE(profiles.nickname, EXCLUDED.nickname),
    openid = COALESCE(EXCLUDED.openid, profiles.openid),
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "on_auth_user_created" ON "auth"."users";
CREATE TRIGGER "on_auth_user_created"
AFTER INSERT ON "auth"."users"
FOR EACH ROW
WHEN ("new"."confirmed_at" IS NOT NULL)
EXECUTE FUNCTION "public"."handle_new_user"();

DROP TRIGGER IF EXISTS "on_auth_user_confirmed" ON "auth"."users";
CREATE TRIGGER "on_auth_user_confirmed"
AFTER UPDATE ON "auth"."users"
FOR EACH ROW
WHEN ((("old"."confirmed_at" IS NULL) AND ("new"."confirmed_at" IS NOT NULL)))
EXECUTE FUNCTION "public"."handle_new_user"();
