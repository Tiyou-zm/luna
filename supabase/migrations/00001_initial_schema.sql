
-- User roles
CREATE TYPE user_role AS ENUM ('user', 'admin');
CREATE TYPE membership_level AS ENUM ('free', 'graphic', 'video_starter', 'video_pro', 'professional', 'enterprise');
CREATE TYPE order_status AS ENUM ('pending', 'paid', 'completed', 'cancelled', 'refunded');

-- Profiles table
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE,
  nickname text,
  avatar_url text,
  openid text,
  role user_role DEFAULT 'user',
  membership_level membership_level DEFAULT 'free',
  membership_expires timestamptz,
  balance numeric(12,2) DEFAULT 0,
  ai_count integer DEFAULT 0,
  bound_accounts integer DEFAULT 0,
  phone text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Helper function to avoid policy recursion
CREATE OR REPLACE FUNCTION is_admin(uid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = uid AND role = 'admin'::user_role);
$$;

-- Profiles policies
CREATE POLICY "Admins have full access to profiles" ON profiles
  FOR ALL TO authenticated USING (is_admin(auth.uid()));

CREATE POLICY "Users can view their own profile" ON profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id)
  WITH CHECK (role IS NOT DISTINCT FROM (SELECT role FROM profiles WHERE id = auth.uid()));

-- Trigger: sync new user to profiles
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  user_count int;
  uname text;
BEGIN
  SELECT COUNT(*) INTO user_count FROM profiles;
  -- Extract username from email or metadata
  uname := COALESCE(
    (NEW.raw_user_meta_data->>'username')::text,
    split_part(NEW.email, '@', 1)
  );
  INSERT INTO public.profiles (id, username, nickname, openid, role)
  VALUES (
    NEW.id,
    uname,
    COALESCE((NEW.raw_user_meta_data->>'nickname')::text, uname),
    COALESCE((NEW.raw_user_meta_data->>'openid')::text, NULL),
    CASE WHEN user_count = 0 THEN 'admin'::user_role ELSE 'user'::user_role END
  )
  ON CONFLICT (id) DO UPDATE SET
    openid = COALESCE(EXCLUDED.openid, profiles.openid),
    updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_confirmed
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL)
  EXECUTE FUNCTION handle_new_user();

-- Conversations table
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title text DEFAULT '新对话',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own conversations" ON conversations
  FOR ALL TO authenticated USING (user_id = auth.uid());

-- Messages table
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  tokens_used integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own messages" ON messages
  FOR ALL TO authenticated USING (user_id = auth.uid());

-- Customer service messages table
CREATE TABLE public.cs_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.cs_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own cs_messages" ON cs_messages
  FOR ALL TO authenticated USING (user_id = auth.uid());

-- Orders table (subscription orders)
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no text UNIQUE NOT NULL,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  openid text NOT NULL,
  plan_name text NOT NULL,
  plan_level membership_level NOT NULL,
  status order_status DEFAULT 'pending',
  amount numeric(10,2) NOT NULL,
  wechat_transaction_id text,
  version integer DEFAULT 0,
  paid_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own orders" ON orders
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users insert own orders" ON orders
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Materials table
CREATE TABLE public.materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('copywriting', 'script', 'work', 'image')),
  title text NOT NULL,
  content text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own materials" ON materials
  FOR ALL TO authenticated USING (user_id = auth.uid());

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE cs_messages;

-- Seed: sample data for plans (stored in app, no table needed)
-- Insert test AI count tracking via ai_count field in profiles
