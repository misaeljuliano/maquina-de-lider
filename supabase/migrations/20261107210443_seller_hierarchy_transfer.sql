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
  supervisor_executive_id uuid;
  moved_count integer := 0;
BEGIN
  IF p_move_team IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Informe se a equipe deve acompanhar o supervisor.';
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
    SET executive_user_id = p_new_executive_user_id,
        supervisor_user_id = NULL
    WHERE id = p_seller_id;

    IF p_move_team THEN
      UPDATE public.sellers
      SET executive_user_id = p_new_executive_user_id
      WHERE supervisor_user_id = target.seller_user_id;
    ELSE
      UPDATE public.sellers
      SET supervisor_user_id = NULL
      WHERE supervisor_user_id = target.seller_user_id;
    END IF;
    GET DIAGNOSTICS moved_count = ROW_COUNT;
  ELSE
    IF p_new_supervisor_user_id IS NOT NULL THEN
      SELECT s.executive_user_id INTO supervisor_executive_id
      FROM public.sellers s
      JOIN public.user_roles ur ON ur.user_id = s.seller_user_id AND ur.role = 'SUPERVISOR'
      WHERE s.seller_user_id = p_new_supervisor_user_id AND s.active
      LIMIT 1;

      IF NOT FOUND OR supervisor_executive_id IS DISTINCT FROM p_new_executive_user_id THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Supervisor de destino não pertence ao executivo selecionado.';
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
