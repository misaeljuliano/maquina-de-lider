CREATE TABLE IF NOT EXISTS private.seller_user_access (
  seller_id uuid NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (seller_id, user_id)
);

ALTER TABLE private.seller_user_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.seller_user_access FROM PUBLIC, anon, authenticated, service_role;

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
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_seller(uuid) TO authenticated;