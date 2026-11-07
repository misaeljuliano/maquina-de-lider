-- Migration proposal. Review against the target schema before applying.
BEGIN;

-- Keep history independent of lead and user deletion. Do not copy lead
-- contact details or actor profile data into this table.
CREATE TABLE private.lead_observation_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  previous_observation text,
  new_observation text,
  CHECK (previous_observation IS DISTINCT FROM new_observation)
);

ALTER TABLE private.lead_observation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.lead_observation_audit
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.record_lead_observation_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  actor uuid := auth.uid();
  previous_value text;
  previous_crm_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    previous_value := OLD.observation;
    previous_crm_id := OLD.crm_external_id;
  END IF;
  IF previous_crm_id IS DISTINCT FROM NEW.crm_external_id AND (
    actor IS NOT NULL OR current_setting('role') IN ('anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'CRM ID is read-only for clients' USING ERRCODE = '42501';
  END IF;
  IF previous_value IS NOT DISTINCT FROM NEW.observation THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = actor AND role = 'GERENTE'::public.app_role
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF char_length(NEW.observation) > 2000 THEN
    RAISE EXCEPTION 'observation exceeds 2000 characters' USING ERRCODE = '22001';
  END IF;

  INSERT INTO private.lead_observation_audit
    (lead_id, actor_id, previous_observation, new_observation)
  VALUES (NEW.id, actor, previous_value, NEW.observation);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION private.record_lead_observation_change()
  FROM PUBLIC, anon, authenticated, service_role;

-- Preserve existing grants and RLS for other fields. Check the final
-- stored value, including changes made through other SQL entry points.
CREATE TRIGGER record_lead_observation_change
AFTER INSERT OR UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION private.record_lead_observation_change();

-- Match the manager scope of manager_lead_private_fields. The explicit
-- role check is required here even when the trigger sees no change.
CREATE FUNCTION public.manager_update_lead_observation(
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
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'GERENTE'::public.app_role
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  normalized_observation := NULLIF(
    regexp_replace(p_observation, '^[[:space:]]+|[[:space:]]+$', '', 'g'),
    ''
  );
  IF char_length(normalized_observation) > 2000 THEN
    RAISE EXCEPTION 'observation exceeds 2000 characters' USING ERRCODE = '22001';
  END IF;

  -- Lock and compare before writing. A retry with the same desired value
  -- can succeed without touching the row or appending another audit event.
  SELECT observation INTO saved_observation
  FROM public.leads WHERE id = p_lead_id FOR UPDATE;

  IF NOT FOUND OR (
    saved_observation IS DISTINCT FROM p_expected_observation
    AND saved_observation IS DISTINCT FROM normalized_observation
  ) THEN
    RAISE EXCEPTION 'observation changed or lead unavailable' USING ERRCODE = 'PT409';
  END IF;

  IF saved_observation IS DISTINCT FROM normalized_observation THEN
    UPDATE public.leads SET observation = normalized_observation
    WHERE id = p_lead_id
    RETURNING observation INTO saved_observation;
  END IF;
  RETURN saved_observation;
END;
$function$;

REVOKE ALL ON FUNCTION public.manager_update_lead_observation(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manager_update_lead_observation(uuid, text, text)
  TO authenticated;

COMMIT;
