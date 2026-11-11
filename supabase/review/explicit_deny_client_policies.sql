-- Defense in depth for service-only tables flagged by the RLS advisor.
-- These restrictive policies deny anon/authenticated even if privileges or a
-- permissive policy are added later. service_role bypasses RLS and remains
-- the only application path for seller_onboarding; private tables stay internal.

DROP POLICY IF EXISTS deny_client_access ON private.lead_observation_audit;
CREATE POLICY deny_client_access
ON private.lead_observation_audit
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS deny_client_access ON private.seller_user_access;
CREATE POLICY deny_client_access
ON private.seller_user_access
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS deny_client_access ON public.seller_onboarding;
CREATE POLICY deny_client_access
ON public.seller_onboarding
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);
