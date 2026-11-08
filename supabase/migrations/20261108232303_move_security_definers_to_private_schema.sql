CREATE OR REPLACE FUNCTION private.manager_lead_private_fields_internal(p_lead_ids uuid[] DEFAULT NULL::uuid[])
RETURNS TABLE(lead_id uuid, observation text, crm_external_id text)
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

CREATE OR REPLACE FUNCTION private.manager_update_lead_observation_internal(
  p_lead_id uuid,
  p_expected_observation text,
  p_observation text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  saved_observation text;
  normalized_observation text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role = 'GERENTE'::public.app_role
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  normalized_observation := NULLIF(
    pg_catalog.regexp_replace(
      p_observation,
      '^[[:space:]]+|[[:space:]]+$',
      '',
      'g'
    ),
    ''
  );

  IF pg_catalog.char_length(normalized_observation) > 2000 THEN
    RAISE EXCEPTION 'observation exceeds 2000 characters' USING ERRCODE = '22001';
  END IF;

  SELECT observation
  INTO saved_observation
  FROM public.leads
  WHERE id = p_lead_id
  FOR UPDATE;

  IF NOT FOUND OR (
    saved_observation IS DISTINCT FROM p_expected_observation
    AND saved_observation IS DISTINCT FROM normalized_observation
  ) THEN
    RAISE EXCEPTION 'observation changed or lead unavailable' USING ERRCODE = 'PT409';
  END IF;

  IF saved_observation IS DISTINCT FROM normalized_observation THEN
    UPDATE public.leads
    SET observation = normalized_observation
    WHERE id = p_lead_id
    RETURNING observation INTO saved_observation;
  END IF;

  RETURN saved_observation;
END;
$function$;

CREATE OR REPLACE FUNCTION private.wallet_password_ready_internal()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.id = auth.uid()
      AND (u.invited_at IS NULL OR NULLIF(u.encrypted_password, '') IS NOT NULL)
  );
$function$;

REVOKE ALL ON FUNCTION private.manager_lead_private_fields_internal(uuid[]) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION private.manager_update_lead_observation_internal(uuid, text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION private.wallet_password_ready_internal() FROM PUBLIC, anon, service_role;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.manager_lead_private_fields_internal(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION private.manager_update_lead_observation_internal(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.wallet_password_ready_internal() TO authenticated;

CREATE OR REPLACE FUNCTION public.manager_lead_private_fields(p_lead_ids uuid[] DEFAULT NULL::uuid[])
RETURNS TABLE(lead_id uuid, observation text, crm_external_id text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT *
  FROM private.manager_lead_private_fields_internal(p_lead_ids);
$function$;

CREATE OR REPLACE FUNCTION public.manager_update_lead_observation(
  p_lead_id uuid,
  p_expected_observation text,
  p_observation text
)
RETURNS text
LANGUAGE sql
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT private.manager_update_lead_observation_internal(
    p_lead_id,
    p_expected_observation,
    p_observation
  );
$function$;

CREATE OR REPLACE FUNCTION public.wallet_password_ready()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT private.wallet_password_ready_internal();
$function$;

REVOKE ALL ON FUNCTION public.manager_lead_private_fields(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.manager_update_lead_observation(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wallet_password_ready() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_lead_private_fields(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_update_lead_observation(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_password_ready() TO authenticated;