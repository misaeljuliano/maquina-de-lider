-- Defense in depth: hierarchy and transfer audit tables are server-only.
DROP POLICY IF EXISTS deny_client_access ON public.leader_hierarchy;
CREATE POLICY deny_client_access
ON public.leader_hierarchy
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS deny_client_access ON public.leader_transfer_log;
CREATE POLICY deny_client_access
ON public.leader_transfer_log
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);
