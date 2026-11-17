-- A supervisor may work with multiple executive/coordinators.
-- Seller rows still carry the exact executive + supervisor responsible for each seller.
CREATE TABLE IF NOT EXISTS public.supervisor_executives (
  supervisor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  executive_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (supervisor_user_id, executive_user_id),
  CONSTRAINT supervisor_executives_distinct_users CHECK (supervisor_user_id <> executive_user_id)
);

ALTER TABLE public.supervisor_executives ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.supervisor_executives FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.supervisor_executives TO service_role;

-- Preserve existing assignments, including relationships evidenced by sellers' own hierarchy.
INSERT INTO public.supervisor_executives (supervisor_user_id, executive_user_id)
SELECT DISTINCT links.supervisor_user_id, links.executive_user_id
FROM (
  SELECT s.seller_user_id AS supervisor_user_id, s.executive_user_id
  FROM public.sellers s
  JOIN public.user_roles ur ON ur.user_id = s.seller_user_id
  WHERE ur.role = 'SUPERVISOR'::public.app_role
    AND s.seller_user_id IS NOT NULL
    AND s.executive_user_id IS NOT NULL
  UNION
  SELECT s.supervisor_user_id, s.executive_user_id
  FROM public.sellers s
  WHERE s.supervisor_user_id IS NOT NULL
    AND s.executive_user_id IS NOT NULL
) links
JOIN public.user_roles supervisor_role
  ON supervisor_role.user_id = links.supervisor_user_id
 AND supervisor_role.role = 'SUPERVISOR'::public.app_role
JOIN public.user_roles executive_role
  ON executive_role.user_id = links.executive_user_id
 AND executive_role.role = 'EXECUTIVO'::public.app_role
ON CONFLICT (supervisor_user_id, executive_user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.supervisor_linked_to_active_executive(
  p_supervisor_user_id uuid,
  p_executive_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.supervisor_executives se
    JOIN public.user_roles supervisor_role
      ON supervisor_role.user_id = se.supervisor_user_id
     AND supervisor_role.role = 'SUPERVISOR'::public.app_role
    JOIN public.sellers supervisor_profile
      ON supervisor_profile.seller_user_id = se.supervisor_user_id
     AND supervisor_profile.active IS TRUE
    JOIN public.user_roles executive_role
      ON executive_role.user_id = se.executive_user_id
     AND executive_role.role = 'EXECUTIVO'::public.app_role
    JOIN public.sellers executive_profile
      ON executive_profile.seller_user_id = se.executive_user_id
     AND executive_profile.active IS TRUE
    WHERE se.supervisor_user_id = p_supervisor_user_id
      AND se.executive_user_id = p_executive_user_id
  );
$function$;

REVOKE ALL ON FUNCTION private.supervisor_linked_to_active_executive(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.supervisor_linked_to_active_executive(uuid, uuid)
  TO authenticated;

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
      AND ur.role IN ('GERENTE'::public.app_role, 'EXECUTIVO'::public.app_role, 'SUPERVISOR'::public.app_role)
      AND (
        ur.role IN ('GERENTE'::public.app_role, 'EXECUTIVO'::public.app_role)
        OR EXISTS (
          SELECT 1
          FROM public.supervisor_executives se
          WHERE se.supervisor_user_id = p_user_id
        )
        OR leader_profile.executive_user_id IS NULL
      )
  );
$function$;

REVOKE ALL ON FUNCTION private.has_active_leader_profile(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.has_active_leader_profile(uuid)
  TO authenticated;

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

DROP POLICY IF EXISTS sellers_select_scoped ON public.sellers;
CREATE POLICY sellers_select_scoped
ON public.sellers
FOR SELECT
TO authenticated
USING (private.can_access_seller(id));

COMMENT ON TABLE public.supervisor_executives IS
  'Many-to-many assignment of supervisors to executive/coordinator portfolios. Seller rows define each seller’s exact executive and supervisor.';

CREATE OR REPLACE FUNCTION public.transfer_seller_hierarchy(
  p_seller_id uuid,
  p_expected_supervisor_user_id uuid,
  p_expected_executive_user_id uuid,
  p_new_supervisor_user_id uuid,
  p_new_executive_user_id uuid,
  p_move_team boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  target public.sellers%ROWTYPE;
  target_role text;
  moved_count integer := 0;
BEGIN
  IF p_move_team IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Informe se a equipe deve acompanhar o supervisor.';
  END IF;

  SELECT * INTO target FROM public.sellers WHERE id = p_seller_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Integrante não encontrado.';
  END IF;

  IF target.supervisor_user_id IS DISTINCT FROM p_expected_supervisor_user_id
     OR target.executive_user_id IS DISTINCT FROM p_expected_executive_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'A equipe mudou durante a transferência.';
  END IF;

  SELECT role::text INTO target_role FROM public.user_roles WHERE user_id = target.seller_user_id;
  IF target_role IS NULL OR target_role NOT IN ('VENDEDOR', 'SUPERVISOR') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Perfil sem transferência disponível.';
  END IF;

  IF p_new_executive_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.sellers s ON s.seller_user_id = ur.user_id AND s.active
    WHERE ur.user_id = p_new_executive_user_id AND ur.role = 'EXECUTIVO'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Executivo de destino inválido ou inativo.';
  END IF;

  IF target_role = 'SUPERVISOR' THEN
    IF p_new_supervisor_user_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Supervisor não pode ser subordinado a outro supervisor.';
    END IF;

    UPDATE public.sellers
    SET executive_user_id = p_new_executive_user_id, supervisor_user_id = NULL
    WHERE id = p_seller_id;

    IF p_new_executive_user_id IS NOT NULL THEN
      INSERT INTO public.supervisor_executives (supervisor_user_id, executive_user_id)
      VALUES (target.seller_user_id, p_new_executive_user_id)
      ON CONFLICT (supervisor_user_id, executive_user_id) DO NOTHING;
    END IF;

    IF p_move_team THEN
      UPDATE public.sellers SET executive_user_id = p_new_executive_user_id
      WHERE supervisor_user_id = target.seller_user_id;
    ELSE
      UPDATE public.sellers SET supervisor_user_id = NULL
      WHERE supervisor_user_id = target.seller_user_id;
    END IF;
    GET DIAGNOSTICS moved_count = ROW_COUNT;
  ELSE
    IF p_new_supervisor_user_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.sellers s ON s.seller_user_id = ur.user_id AND s.active
        WHERE ur.user_id = p_new_supervisor_user_id
          AND ur.role = 'SUPERVISOR'
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Supervisor de destino inválido ou inativo.';
      END IF;
      IF p_new_executive_user_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.supervisor_executives se
        WHERE se.supervisor_user_id = p_new_supervisor_user_id
          AND se.executive_user_id = p_new_executive_user_id
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Supervisor não está associado ao executivo selecionado.';
      END IF;
    END IF;

    UPDATE public.sellers
    SET executive_user_id = p_new_executive_user_id,
        supervisor_user_id = p_new_supervisor_user_id
    WHERE id = p_seller_id;
    GET DIAGNOSTICS moved_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('ok', true, 'updated_rows', moved_count + 1);
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_seller_hierarchy(uuid, uuid, uuid, uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_seller_hierarchy(uuid, uuid, uuid, uuid, uuid, boolean)
  TO service_role;
