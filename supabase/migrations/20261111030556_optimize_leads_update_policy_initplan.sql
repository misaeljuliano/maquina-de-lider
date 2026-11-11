-- Cache the authenticated user ID once per statement in the lead update policy.
-- This keeps the existing seller-only authorization rules unchanged.
DROP POLICY IF EXISTS leads_update_scoped ON public.leads;

CREATE POLICY leads_update_scoped
ON public.leads
FOR UPDATE
TO authenticated
USING (
  private.can_access_seller(seller_id)
  AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = (SELECT auth.uid())
      AND ur.role = 'VENDEDOR'::public.app_role
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = (SELECT auth.uid())
      AND ur.role IN (
        'GERENTE'::public.app_role,
        'EXECUTIVO'::public.app_role,
        'SUPERVISOR'::public.app_role
      )
  )
)
WITH CHECK (
  private.can_access_seller(seller_id)
  AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = (SELECT auth.uid())
      AND ur.role = 'VENDEDOR'::public.app_role
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = (SELECT auth.uid())
      AND ur.role IN (
        'GERENTE'::public.app_role,
        'EXECUTIVO'::public.app_role,
        'SUPERVISOR'::public.app_role
      )
  )
);
