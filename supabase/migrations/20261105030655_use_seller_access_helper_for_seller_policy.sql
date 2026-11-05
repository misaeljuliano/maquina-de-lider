-- Keep seller profile reads consistent with the central active-seller access rule.
DROP POLICY IF EXISTS sellers_select_scoped ON public.sellers;
CREATE POLICY sellers_select_scoped
ON public.sellers
FOR SELECT
TO authenticated
USING (private.can_access_seller(id));
