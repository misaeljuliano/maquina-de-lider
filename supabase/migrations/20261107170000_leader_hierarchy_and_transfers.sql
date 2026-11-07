-- Store the current executive relationship for supervisors and log wallet transfers.
CREATE TABLE IF NOT EXISTS public.leader_hierarchy (
  user_id uuid PRIMARY KEY,
  role public.app_role NOT NULL
    CHECK (role IN ('EXECUTIVO'::public.app_role, 'SUPERVISOR'::public.app_role)),
  executive_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  invite_email_status text NOT NULL DEFAULT 'pending'
    CHECK (invite_email_status IN ('pending', 'sent', 'failed')),
  invite_email_error text NULL,
  invite_attempt_count integer NOT NULL DEFAULT 0 CHECK (invite_attempt_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leader_hierarchy_user_role_fk
    FOREIGN KEY (user_id, role)
    REFERENCES public.user_roles(user_id, role)
    ON DELETE CASCADE,
  CONSTRAINT leader_hierarchy_parent_not_self
    CHECK (executive_user_id IS NULL OR executive_user_id <> user_id),
  CONSTRAINT leader_hierarchy_executive_has_no_parent
    CHECK (role <> 'EXECUTIVO'::public.app_role OR executive_user_id IS NULL)
);

CREATE INDEX IF NOT EXISTS leader_hierarchy_executive_idx
  ON public.leader_hierarchy (executive_user_id, user_id)
  WHERE role = 'SUPERVISOR'::public.app_role;

ALTER TABLE public.leader_hierarchy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.leader_hierarchy FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.leader_hierarchy TO service_role;

CREATE TABLE IF NOT EXISTS public.leader_transfer_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  entity_type text NOT NULL CHECK (entity_type IN ('SUPERVISOR', 'VENDEDOR')),
  entity_id uuid NOT NULL,
  from_executive_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  to_executive_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  from_supervisor_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  to_supervisor_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  carried_sellers boolean NULL,
  affected_seller_count integer NOT NULL DEFAULT 0 CHECK (affected_seller_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.leader_transfer_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.leader_transfer_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.leader_transfer_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.leader_transfer_log_id_seq TO service_role;

CREATE OR REPLACE FUNCTION private.validate_leader_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.role = 'EXECUTIVO'::public.app_role AND NEW.executive_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Executivos não podem ter um executivo ascendente.' USING ERRCODE = '23514';
  END IF;

  IF NEW.role = 'SUPERVISOR'::public.app_role
    AND NEW.executive_user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = NEW.executive_user_id
        AND ur.role = 'EXECUTIVO'::public.app_role
    ) THEN
    RAISE EXCEPTION 'O ascendente informado não é um Executivo/Coordenador.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS validate_leader_hierarchy_before_write ON public.leader_hierarchy;
CREATE TRIGGER validate_leader_hierarchy_before_write
BEFORE INSERT OR UPDATE OF role, executive_user_id
ON public.leader_hierarchy
FOR EACH ROW EXECUTE FUNCTION private.validate_leader_hierarchy();

-- Backfill legacy supervisors only when all currently assigned sellers point to one valid executive.
INSERT INTO public.leader_hierarchy (
  user_id, role, executive_user_id, invite_email_status
)
SELECT
  ur.user_id,
  ur.role,
  CASE WHEN ur.role = 'SUPERVISOR'::public.app_role THEN legacy_parent.executive_user_id ELSE NULL END,
  'sent'
FROM public.user_roles ur
LEFT JOIN LATERAL (
  SELECT CASE
    WHEN count(DISTINCT s.executive_user_id) = 1
      THEN (array_agg(DISTINCT s.executive_user_id))[1]
    ELSE NULL
  END AS executive_user_id
  FROM public.sellers s
  JOIN public.user_roles exec_role
    ON exec_role.user_id = s.executive_user_id
   AND exec_role.role = 'EXECUTIVO'::public.app_role
  WHERE s.supervisor_user_id = ur.user_id
) legacy_parent ON true
WHERE ur.role IN ('EXECUTIVO'::public.app_role, 'SUPERVISOR'::public.app_role)
ON CONFLICT (user_id) DO NOTHING;

-- Normalize seller ancestry to the supervisor's current parent; leads remain attached to the same seller.
UPDATE public.sellers s
SET executive_user_id = h.executive_user_id
FROM public.leader_hierarchy h
WHERE h.role = 'SUPERVISOR'::public.app_role
  AND h.user_id = s.supervisor_user_id
  AND s.executive_user_id IS DISTINCT FROM h.executive_user_id;

CREATE OR REPLACE FUNCTION public.transfer_seller_wallet(
  p_actor_user_id uuid,
  p_seller_id uuid,
  p_target_executive_user_id uuid,
  p_target_supervisor_user_id uuid
)
RETURNS TABLE (
  seller_id uuid,
  executive_user_id uuid,
  supervisor_user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_is_manager boolean;
  v_is_executive boolean;
  v_is_supervisor boolean;
  v_seller public.sellers%ROWTYPE;
  v_actor_executive uuid;
  v_target_supervisor_executive uuid;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_actor_user_id AND ur.role = 'GERENTE'::public.app_role
  ) INTO v_is_manager;
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_actor_user_id AND ur.role = 'EXECUTIVO'::public.app_role
  ) INTO v_is_executive;
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_actor_user_id AND ur.role = 'SUPERVISOR'::public.app_role
  ) INTO v_is_supervisor;

  IF NOT v_is_manager AND NOT v_is_executive AND NOT v_is_supervisor THEN
    RAISE EXCEPTION 'Acesso não autorizado.' USING ERRCODE = '42501';
  END IF;

  SELECT s.* INTO v_seller
  FROM public.sellers s
  WHERE s.id = p_seller_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vendedor não encontrado.' USING ERRCODE = 'P0002'; END IF;

  SELECT h.executive_user_id INTO v_actor_executive
  FROM public.leader_hierarchy h
  WHERE h.user_id = p_actor_user_id AND h.role = 'SUPERVISOR'::public.app_role;

  IF v_is_manager THEN
    NULL;
  ELSIF v_is_executive THEN
    IF v_seller.executive_user_id IS DISTINCT FROM p_actor_user_id THEN
      RAISE EXCEPTION 'Esse vendedor não pertence à sua equipe.' USING ERRCODE = '42501';
    END IF;
    IF p_target_executive_user_id IS DISTINCT FROM p_actor_user_id THEN
      RAISE EXCEPTION 'Executivos só podem transferir vendedores dentro da própria equipe.' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_seller.supervisor_user_id IS DISTINCT FROM p_actor_user_id THEN
      RAISE EXCEPTION 'Esse vendedor não pertence à sua carteira.' USING ERRCODE = '42501';
    END IF;
    IF p_target_executive_user_id IS DISTINCT FROM v_actor_executive THEN
      RAISE EXCEPTION 'Supervisores só podem transferir vendedores dentro da própria hierarquia.' USING ERRCODE = '42501';
    END IF;
    IF v_actor_executive IS NULL AND p_target_supervisor_user_id IS NOT NULL
      AND p_target_supervisor_user_id IS DISTINCT FROM p_actor_user_id THEN
      RAISE EXCEPTION 'Esse Supervisor não pertence à sua hierarquia.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_target_executive_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_target_executive_user_id AND ur.role = 'EXECUTIVO'::public.app_role
  ) THEN
    RAISE EXCEPTION 'Executivo/Coordenador inválido.' USING ERRCODE = '23514';
  END IF;

  IF p_target_supervisor_user_id IS NOT NULL THEN
    SELECT h.executive_user_id INTO v_target_supervisor_executive
    FROM public.leader_hierarchy h
    WHERE h.user_id = p_target_supervisor_user_id AND h.role = 'SUPERVISOR'::public.app_role;
    IF NOT FOUND THEN RAISE EXCEPTION 'Supervisor inválido.' USING ERRCODE = '23514'; END IF;
    IF v_target_supervisor_executive IS DISTINCT FROM p_target_executive_user_id THEN
      RAISE EXCEPTION 'Supervisor e Executivo não pertencem à mesma hierarquia.' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_is_executive AND p_target_supervisor_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.leader_hierarchy h
    WHERE h.user_id = p_target_supervisor_user_id
      AND h.role = 'SUPERVISOR'::public.app_role
      AND h.executive_user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Esse Supervisor não pertence à sua equipe.' USING ERRCODE = '42501';
  END IF;

  IF v_is_supervisor AND p_target_supervisor_user_id IS NOT NULL
    AND p_target_supervisor_user_id IS DISTINCT FROM p_actor_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.leader_hierarchy h
      WHERE h.user_id = p_target_supervisor_user_id
        AND h.role = 'SUPERVISOR'::public.app_role
        AND h.executive_user_id = v_actor_executive
        AND v_actor_executive IS NOT NULL
    ) THEN
    RAISE EXCEPTION 'Esse Supervisor não pertence à sua hierarquia.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.sellers s
  SET executive_user_id = p_target_executive_user_id,
      supervisor_user_id = p_target_supervisor_user_id
  WHERE s.id = p_seller_id;

  INSERT INTO public.leader_transfer_log (
    actor_user_id, entity_type, entity_id,
    from_executive_user_id, to_executive_user_id,
    from_supervisor_user_id, to_supervisor_user_id,
    affected_seller_count
  ) VALUES (
    p_actor_user_id, 'VENDEDOR', p_seller_id,
    v_seller.executive_user_id, p_target_executive_user_id,
    v_seller.supervisor_user_id, p_target_supervisor_user_id, 1
  );

  RETURN QUERY SELECT s.id, s.executive_user_id, s.supervisor_user_id
  FROM public.sellers s WHERE s.id = p_seller_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.transfer_supervisor_wallet(
  p_actor_user_id uuid,
  p_supervisor_user_id uuid,
  p_target_executive_user_id uuid,
  p_carry_sellers boolean
)
RETURNS TABLE (
  supervisor_user_id uuid,
  executive_user_id uuid,
  affected_seller_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_is_manager boolean;
  v_is_executive boolean;
  v_current_executive uuid;
  v_count integer;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_actor_user_id AND ur.role = 'GERENTE'::public.app_role
  ) INTO v_is_manager;
  v_is_executive := EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_actor_user_id AND ur.role = 'EXECUTIVO'::public.app_role
  );
  IF NOT v_is_manager AND NOT v_is_executive THEN
    RAISE EXCEPTION 'Somente gerentes e executivos podem transferir supervisores.' USING ERRCODE = '42501';
  END IF;

  SELECT h.executive_user_id INTO v_current_executive
  FROM public.leader_hierarchy h
  WHERE h.user_id = p_supervisor_user_id AND h.role = 'SUPERVISOR'::public.app_role
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supervisor não encontrado.' USING ERRCODE = 'P0002'; END IF;

  IF v_is_executive AND (
    v_current_executive IS DISTINCT FROM p_actor_user_id
    OR p_target_executive_user_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Executivos só podem liberar um Supervisor de sua própria equipe para a gerência.' USING ERRCODE = '42501';
  END IF;
  IF v_is_manager AND p_target_executive_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_target_executive_user_id AND ur.role = 'EXECUTIVO'::public.app_role
  ) THEN
    RAISE EXCEPTION 'Executivo/Coordenador inválido.' USING ERRCODE = '23514';
  END IF;
  IF p_target_executive_user_id IS NOT DISTINCT FROM v_current_executive THEN
    RAISE EXCEPTION 'O Supervisor já pertence a essa carteira.' USING ERRCODE = '23514';
  END IF;

  IF p_carry_sellers THEN
    UPDATE public.sellers s
    SET executive_user_id = p_target_executive_user_id
    WHERE s.supervisor_user_id = p_supervisor_user_id;
  ELSE
    UPDATE public.sellers s
    SET executive_user_id = v_current_executive,
        supervisor_user_id = NULL
    WHERE s.supervisor_user_id = p_supervisor_user_id;
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.leader_hierarchy h
  SET executive_user_id = p_target_executive_user_id,
      updated_at = now()
  WHERE h.user_id = p_supervisor_user_id;

  INSERT INTO public.leader_transfer_log (
    actor_user_id, entity_type, entity_id,
    from_executive_user_id, to_executive_user_id,
    carried_sellers, affected_seller_count
  ) VALUES (
    p_actor_user_id, 'SUPERVISOR', p_supervisor_user_id,
    v_current_executive, p_target_executive_user_id,
    p_carry_sellers, v_count
  );

  RETURN QUERY SELECT p_supervisor_user_id, p_target_executive_user_id, v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_seller_wallet(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_seller_wallet(uuid, uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.transfer_supervisor_wallet(uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_supervisor_wallet(uuid, uuid, uuid, boolean) TO service_role;

