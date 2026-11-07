-- Deactivated leaders cannot access their teams. A supervisor's team access
-- also requires the executive above them to remain active.
CREATE OR REPLACE FUNCTION private.has_active_leader_profile(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.sellers leader_profile
      ON leader_profile.seller_user_id = ur.user_id
     AND leader_profile.active IS TRUE
    WHERE ur.user_id = p_user_id
      AND ur.role IN ('EXECUTIVO'::public.app_role, 'SUPERVISOR'::public.app_role)
      AND (
        ur.role = 'EXECUTIVO'::public.app_role
        OR leader_profile.executive_user_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.user_roles executive_role
          JOIN public.sellers executive_profile
            ON executive_profile.seller_user_id = executive_role.user_id
           AND executive_profile.active IS TRUE
          WHERE executive_role.user_id = leader_profile.executive_user_id
            AND executive_role.role = 'EXECUTIVO'::public.app_role
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION private.has_active_leader_profile(uuid)
  FROM PUBLIC, anon, authenticated;

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
          OR (
            s.supervisor_user_id = auth.uid()
            AND private.has_active_leader_profile(auth.uid())
          )
          OR (
            s.executive_user_id = auth.uid()
            AND private.has_active_leader_profile(auth.uid())
          )
        )
    );
$function$;
