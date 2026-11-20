-- An explicit executive-to-supervisor association grants access to that
-- supervisor's active sellers and their leads, including sellers whose
-- primary executive assignment remains with another executive.
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
            AND (
              s.executive_user_id IS NULL
              OR private.supervisor_linked_to_active_executive(auth.uid(), s.executive_user_id)
            )
          )
          OR (
            s.executive_user_id = auth.uid()
            AND private.has_active_leader_profile(auth.uid())
          )
          OR (
            s.supervisor_user_id IS NOT NULL
            AND private.has_active_leader_profile(auth.uid())
            AND private.supervisor_linked_to_active_executive(s.supervisor_user_id, auth.uid())
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

REVOKE ALL ON FUNCTION private.can_access_seller(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private.can_access_seller(uuid)
  TO authenticated;

CREATE INDEX IF NOT EXISTS supervisor_executives_executive_supervisor_idx
  ON public.supervisor_executives (executive_user_id, supervisor_user_id);

COMMENT ON TABLE public.supervisor_executives IS
  'Explicit supervisor-to-executive access assignments; each linked executive can see the supervisor and that supervisor’s seller team.';

DO $migration$
DECLARE
  executive_count integer;
  supervisor_count integer;
BEGIN
  SELECT count(*) INTO executive_count
  FROM public.sellers s
  JOIN public.user_roles r ON r.user_id = s.seller_user_id AND r.role = 'EXECUTIVO'::public.app_role
  JOIN auth.users u ON u.id = s.seller_user_id
  WHERE lower(u.email) IN ('wendyrmarchetti@yahoo.com.br', 'deluc30@gmail.com')
    AND s.active IS TRUE;

  SELECT count(*) INTO supervisor_count
  FROM public.sellers s
  JOIN public.user_roles r ON r.user_id = s.seller_user_id AND r.role = 'SUPERVISOR'::public.app_role
  JOIN auth.users u ON u.id = s.seller_user_id
  WHERE lower(u.email) IN ('broliveira86@hotmail.com', 'jamile.eloy75@gmail.com', 'riluoji2025@gmail.com')
    AND s.active IS TRUE;

  IF executive_count <> 2 OR supervisor_count <> 3 THEN
    RAISE EXCEPTION 'Expected both active executives and all three active supervisors before assigning shared teams';
  END IF;
END;
$migration$;

INSERT INTO public.supervisor_executives (supervisor_user_id, executive_user_id)
SELECT supervisor.seller_user_id, executive.seller_user_id
FROM public.sellers executive
JOIN public.user_roles executive_role
  ON executive_role.user_id = executive.seller_user_id
 AND executive_role.role = 'EXECUTIVO'::public.app_role
JOIN auth.users executive_auth ON executive_auth.id = executive.seller_user_id
JOIN public.sellers supervisor
  ON supervisor.active IS TRUE
JOIN public.user_roles supervisor_role
  ON supervisor_role.user_id = supervisor.seller_user_id
 AND supervisor_role.role = 'SUPERVISOR'::public.app_role
JOIN auth.users supervisor_auth ON supervisor_auth.id = supervisor.seller_user_id
WHERE executive.active IS TRUE
  AND lower(executive_auth.email) IN ('wendyrmarchetti@yahoo.com.br', 'deluc30@gmail.com')
  AND lower(supervisor_auth.email) IN ('broliveira86@hotmail.com', 'jamile.eloy75@gmail.com', 'riluoji2025@gmail.com')
ON CONFLICT (supervisor_user_id, executive_user_id) DO NOTHING;
