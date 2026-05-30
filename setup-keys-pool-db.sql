-- 1. Create keys_pool table
CREATE TABLE IF NOT EXISTS public.keys_pool (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  key_code       TEXT        NOT NULL UNIQUE,
  duration_days  INTEGER     NOT NULL,
  is_used        BOOLEAN     NOT NULL DEFAULT false,
  redeemed_by    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  redeemed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Add expired_at column to user_profiles if it does not exist
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;

-- 3. Create or replace public.redeem_script_key transaction function
CREATE OR REPLACE FUNCTION public.redeem_script_key(p_user_id UUID, p_key_code TEXT)
RETURNS JSON
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duration_days INT;
  v_expired_at TIMESTAMPTZ;
  v_updated_rows INT;
BEGIN
  -- Check if the key exists and is not used, and update atomically
  UPDATE public.keys_pool
  SET is_used = true,
      redeemed_by = p_user_id,
      redeemed_at = now()
  WHERE key_code = p_key_code
    AND is_used = false
  RETURNING duration_days INTO v_duration_days;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    -- Check if it exists but is used, or does not exist at all
    IF EXISTS(SELECT 1 FROM public.keys_pool WHERE key_code = p_key_code) THEN
      RETURN json_build_object('ok', false, 'error', 'คีย์นี้ถูกใช้งานไปแล้ว');
    ELSE
      RETURN json_build_object('ok', false, 'error', 'ไม่พบรหัสคีย์นี้ในระบบ');
    END IF;
  END IF;

  -- Calculate new expiration date: current time + duration_days
  v_expired_at := now() + (v_duration_days || ' days')::interval;

  -- Update user_profiles table with the new script key and expiration date
  UPDATE public.user_profiles
  SET script_key = p_key_code,
      expired_at = v_expired_at
  WHERE user_id = p_user_id;

  RETURN json_build_object(
    'ok', true,
    'key_code', p_key_code,
    'duration_days', v_duration_days,
    'expired_at', v_expired_at
  );
END;
$$ LANGUAGE plpgsql;
