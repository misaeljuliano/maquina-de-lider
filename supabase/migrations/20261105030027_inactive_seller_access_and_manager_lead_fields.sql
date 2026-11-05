-- Restrict inactive seller data and manager-only lead metadata.
CREATE OR REPLACE FUNCTION private.can_access_seller(p_seller_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'GERENTE'::public.app_role
    )
    OR EXISTS (
      SELECT 1
      FROM public.sellers s
      WHERE s.id = p_seller_id
        AND s.active IS TRUE
        AND (
          s.seller_user_id = auth.uid()
          OR s.supervisor_user_id = auth.uid()
          OR s.executive_user_id = auth.uid()
        )
    )
    OR EXISTS (
      SELECT 1
      FROM private.seller_user_access sua
      JOIN public.sellers s ON s.id = sua.seller_id
      WHERE sua.seller_id = p_seller_id
        AND sua.user_id = auth.uid()
        AND s.active IS TRUE
    );
$function$;

DROP POLICY IF EXISTS sellers_select_scoped ON public.sellers;
CREATE POLICY sellers_select_scoped
ON public.sellers
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'GERENTE'::public.app_role
  )
  OR (
    active IS TRUE
    AND (
      seller_user_id = auth.uid()
      OR supervisor_user_id = auth.uid()
      OR executive_user_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM private.seller_user_access sua
        WHERE sua.seller_id = sellers.id
          AND sua.user_id = auth.uid()
      )
    )
  )
);

REVOKE SELECT ON TABLE public.leads FROM PUBLIC, anon, authenticated;
REVOKE SELECT (observation, crm_external_id)
  ON TABLE public.leads FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, seller_id, region, name, address, has_claro, interest, best_time,
  origin, temperature, status, next_step, next_contact_at,
  last_interaction_at, last_interaction_type, submission_id, crm_synced_at,
  created_at, updated_at, product_searched, customer_phone
) ON TABLE public.leads TO authenticated;

CREATE OR REPLACE FUNCTION public.manager_lead_private_fields(p_lead_ids uuid[] DEFAULT NULL)
RETURNS TABLE (
  lead_id uuid,
  observation text,
  crm_external_id text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'GERENTE'::public.app_role
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT l.id, l.observation, l.crm_external_id
  FROM public.leads l
  WHERE p_lead_ids IS NULL OR l.id = ANY (p_lead_ids);
END;
$function$;

REVOKE ALL ON FUNCTION public.manager_lead_private_fields(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_lead_private_fields(uuid[]) TO authenticated;
