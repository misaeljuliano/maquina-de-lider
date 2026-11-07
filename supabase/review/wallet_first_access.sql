-- Review alongside the wallet change. Apply before publishing the Worker.
BEGIN;

CREATE FUNCTION public.wallet_password_ready()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = (SELECT auth.uid())
      AND (u.invited_at IS NULL OR nullif(u.encrypted_password, '') IS NOT NULL)
  );
$$;

REVOKE ALL ON FUNCTION public.wallet_password_ready()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wallet_password_ready() TO authenticated;

CREATE POLICY leads_password_ready ON public.leads
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.wallet_password_ready()))
  WITH CHECK ((SELECT public.wallet_password_ready()));

CREATE POLICY sellers_password_ready ON public.sellers
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.wallet_password_ready()))
  WITH CHECK ((SELECT public.wallet_password_ready()));

COMMIT;

