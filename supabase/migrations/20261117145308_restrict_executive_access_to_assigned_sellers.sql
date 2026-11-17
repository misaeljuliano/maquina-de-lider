-- Executives may see sellers only when the seller row explicitly assigns
-- executive_user_id to them. A shared supervisor relationship alone must not
-- expand an executive's access to that supervisor's entire team.
CREATE OR REPLACE FUNCTION private.can_access_seller(p_seller_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM public.user_roles ur
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
          OR (
            s.supervisor_user_id = auth.uid()
            AND private.has_active_leader_profile(auth.uid())
            AND (
              s.executive_user_id IS NULL
              OR private.supervisor_linked_to_active_executive(auth.uid(), s.executive_user_id)
            )
          )
          OR (
            s.executive_user_id = auth.uid()
            AND private.has_active_leader_profile(auth.uid())
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM private.seller_user_access sua
      JOIN public.sellers s ON s.id = sua.seller_id
      JOIN public.user_roles ur ON ur.user_id = sua.user_id
      WHERE sua.seller_id = p_seller_id
        AND sua.user_id = auth.uid()
        AND ur.role = 'VENDEDOR'::public.app_role
        AND s.active IS TRUE
    );
$function$;

REVOKE ALL ON FUNCTION private.can_access_seller(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private.can_access_seller(uuid) TO authenticated;
