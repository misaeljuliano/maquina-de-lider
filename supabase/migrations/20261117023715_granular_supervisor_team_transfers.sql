-- Extend hierarchy transfers so a manager can choose zero, some, or all of
-- a supervisor's vendors to follow that supervisor to another executive.
-- Individual vendor transfers continue to update exactly one seller row.

CREATE FUNCTION public.transfer_seller_hierarchy_selection(
  p_seller_id uuid,
  p_expected_supervisor_user_id uuid,
  p_expected_executive_user_id uuid,
  p_new_supervisor_user_id uuid,
  p_new_executive_user_id uuid,
  p_move_seller_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  target public.sellers%ROWTYPE;
  target_role text;
  selected_count integer := 0;
BEGIN
  IF p_move_seller_ids IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A lista de vendedores não pode ser nula.';
  END IF;

  SELECT * INTO target
  FROM public.sellers
  WHERE id = p_seller_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Integrante não encontrado.';
  END IF;

  IF target.supervisor_user_id IS DISTINCT FROM p_expected_supervisor_user_id
     OR target.executive_user_id IS DISTINCT FROM p_expected_executive_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'A equipe mudou durante a transferência.';
  END IF;

  SELECT role::text INTO target_role
  FROM public.user_roles
  WHERE user_id = target.seller_user_id;
  IF target_role IS NULL OR target_role NOT IN ('VENDEDOR', 'SUPERVISOR') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Perfil sem transferência disponível.';
  END IF;

  IF p_new_executive_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.sellers s ON s.seller_user_id = ur.user_id AND s.active IS TRUE
    WHERE ur.user_id = p_new_executive_user_id
      AND ur.role = 'EXECUTIVO'::public.app_role
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Executivo de destino inválido ou inativo.';
  END IF;

  IF target_role = 'SUPERVISOR' THEN
    IF p_new_supervisor_user_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Supervisor não pode ser subordinado a outro supervisor.';
    END IF;

    -- Lock every requested team member and reject stale or forged selections.
    IF cardinality(p_move_seller_ids) > 0 THEN
      PERFORM child.id
      FROM public.sellers child
      JOIN public.user_roles child_role ON child_role.user_id = child.seller_user_id
      WHERE child.id = ANY (p_move_seller_ids)
        AND child.supervisor_user_id = target.seller_user_id
        AND child_role.role = 'VENDEDOR'::public.app_role
      ORDER BY child.id
      FOR UPDATE OF child;

      SELECT count(DISTINCT child.id)::integer INTO selected_count
      FROM public.sellers child
      JOIN public.user_roles child_role ON child_role.user_id = child.seller_user_id
      WHERE child.id = ANY (p_move_seller_ids)
        AND child.supervisor_user_id = target.seller_user_id
        AND child_role.role = 'VENDEDOR'::public.app_role;

      IF selected_count <> cardinality(p_move_seller_ids) THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'A equipe mudou. Atualize e escolha os vendedores novamente.';
      END IF;
    END IF;

    UPDATE public.sellers
    SET executive_user_id = p_new_executive_user_id,
        supervisor_user_id = NULL
    WHERE id = p_seller_id;

    IF p_new_executive_user_id IS NOT NULL THEN
      INSERT INTO public.supervisor_executives (supervisor_user_id, executive_user_id)
      VALUES (target.seller_user_id, p_new_executive_user_id)
      ON CONFLICT (supervisor_user_id, executive_user_id) DO NOTHING;
    END IF;

    IF cardinality(p_move_seller_ids) > 0 THEN
      UPDATE public.sellers
      SET executive_user_id = p_new_executive_user_id
      WHERE id = ANY (p_move_seller_ids)
        AND supervisor_user_id = target.seller_user_id;
      GET DIAGNOSTICS selected_count = ROW_COUNT;
    END IF;
  ELSE
    IF cardinality(p_move_seller_ids) > 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Só é possível selecionar vendedores ao transferir um supervisor.';
    END IF;

    IF p_new_supervisor_user_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.user_roles ur
        JOIN public.sellers s ON s.seller_user_id = ur.user_id AND s.active IS TRUE
        WHERE ur.user_id = p_new_supervisor_user_id
          AND ur.role = 'SUPERVISOR'::public.app_role
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Supervisor de destino inválido ou inativo.';
      END IF;
      IF p_new_executive_user_id IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.supervisor_executives se
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
    GET DIAGNOSTICS selected_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'updated_rows', CASE WHEN target_role = 'SUPERVISOR' THEN selected_count + 1 ELSE selected_count END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_seller_hierarchy_selection(uuid, uuid, uuid, uuid, uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_seller_hierarchy_selection(uuid, uuid, uuid, uuid, uuid, uuid[])
  TO service_role;

-- Each active executive may read the entire team of a supervisor linked to
-- that executive. The same relationship is used by the worker's team query.
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

REVOKE ALL ON FUNCTION private.can_access_seller(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private.can_access_seller(uuid) TO authenticated;
