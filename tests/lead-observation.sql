-- Run only in a disposable, empty PostgreSQL instance as a superuser.
-- psql -X -d <disposable_database> -f tests/lead-observation.sql
\set ON_ERROR_STOP on

CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE TYPE public.app_role AS ENUM ('GERENTE', 'VENDEDOR', 'SUPERVISOR', 'EXECUTIVO');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
INSERT INTO public.user_roles VALUES
  ('00000000-0000-0000-0000-000000000001', 'GERENTE'),
  ('00000000-0000-0000-0000-000000000002', 'VENDEDOR'),
  ('00000000-0000-0000-0000-000000000003', 'SUPERVISOR'),
  ('00000000-0000-0000-0000-000000000004', 'EXECUTIVO');

CREATE TABLE public.leads (
  id uuid PRIMARY KEY,
  status text,
  observation text,
  crm_external_id text
);
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
-- Deliberately permissive to exercise the trigger even when RLS allows DML.
CREATE POLICY fixture_access ON public.leads FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
GRANT SELECT (id, status), INSERT, UPDATE ON public.leads TO authenticated;
INSERT INTO public.leads VALUES
  ('00000000-0000-0000-0000-000000000010', 'NOVO', 'Legado', 'CRM-123'),
  ('00000000-0000-0000-0000-000000000012', 'NOVO', 'Outra nota', 'CRM-456');

-- Match the production RPC that exposes these fields only to GERENTE.
CREATE FUNCTION public.manager_lead_private_fields(p_lead_ids uuid[] DEFAULT NULL)
RETURNS TABLE (lead_id uuid, observation text, crm_external_id text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'GERENTE'::public.app_role
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT l.id, l.observation, l.crm_external_id
  FROM public.leads l
  WHERE p_lead_ids IS NULL OR l.id = ANY (p_lead_ids);
END;
$function$;
REVOKE ALL ON FUNCTION public.manager_lead_private_fields(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_lead_private_fields(uuid[])
  TO authenticated;

\ir ../supabase/review/lead_observation.sql

BEGIN;
GRANT USAGE ON SCHEMA private TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  lead uuid := '00000000-0000-0000-0000-000000000010';
  profile integer;
BEGIN
  FOR profile IN 2..5 LOOP
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000' || profile, true);
    BEGIN
      PERFORM public.manager_update_lead_observation(lead, 'Legado', 'Tentativa');
      RAISE EXCEPTION 'Non-manager % called the RPC', profile;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM public.manager_lead_private_fields(NULL);
      RAISE EXCEPTION 'Non-manager % read private lead fields', profile;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      UPDATE public.leads SET observation = 'Tentativa' WHERE id = lead;
      RAISE EXCEPTION 'Non-manager % bypassed the RPC', profile;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      INSERT INTO public.leads (id, observation)
      VALUES ('00000000-0000-0000-0000-000000000011', 'Tentativa');
      RAISE EXCEPTION 'Non-manager % inserted an observation', profile;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;

  UPDATE public.leads SET status = 'PROPOSTA' WHERE id = lead;
  INSERT INTO public.leads (id, status)
  VALUES ('00000000-0000-0000-0000-000000000011', 'NOVO');

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  IF (SELECT count(*) FROM public.manager_lead_private_fields(NULL)) <> 2 OR
     (SELECT count(*) FROM public.manager_lead_private_fields(ARRAY[lead])) <> 1 OR
     NOT EXISTS (
       SELECT 1 FROM public.manager_lead_private_fields(ARRAY[lead])
       WHERE lead_id = lead AND observation = 'Legado' AND crm_external_id = 'CRM-123'
     ) THEN
    RAISE EXCEPTION 'Manager private-field read or lead filter failed';
  END IF;
  BEGIN
    PERFORM observation FROM public.leads WHERE id = lead;
    RAISE EXCEPTION 'Manager read private columns directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  IF public.manager_update_lead_observation(lead, 'Legado', '  Nova  ') IS DISTINCT FROM 'Nova' THEN
    RAISE EXCEPTION 'Manager edit failed';
  END IF;
  PERFORM public.manager_update_lead_observation(lead, 'Legado', 'Nova');
  BEGIN
    PERFORM public.manager_update_lead_observation(lead, 'Legado', 'Desatualizada');
    RAISE EXCEPTION 'Stale edit succeeded';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  BEGIN
    PERFORM public.manager_update_lead_observation(lead, 'Nova', repeat('x', 2001));
    RAISE EXCEPTION 'Oversized note saved';
  EXCEPTION WHEN string_data_right_truncation THEN NULL;
  END;
  BEGIN
    UPDATE public.leads SET crm_external_id = 'Tentativa' WHERE id = lead;
    RAISE EXCEPTION 'Manager edited the CRM ID';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF public.manager_update_lead_observation(lead, 'Nova', '  ') IS NOT NULL THEN
    RAISE EXCEPTION 'Manager could not clear the observation';
  END IF;
  BEGIN
    PERFORM public.manager_update_lead_observation(lead, NULL, 'Descartada');
    RAISE EXCEPTION USING ERRCODE = 'PT422', MESSAGE = 'force rollback of edit and audit';
  EXCEPTION WHEN SQLSTATE 'PT422' THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM private.lead_observation_audit;
    RAISE EXCEPTION 'Manager accessed private audit data';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

SET LOCAL ROLE anon;
DO $$
BEGIN
  IF has_function_privilege(
    current_user, 'public.manager_update_lead_observation(uuid,text,text)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Anonymous role can execute the RPC';
  END IF;
END;
$$;

RESET ROLE;
DO $$
DECLARE
  lead uuid := '00000000-0000-0000-0000-000000000010';
  manager uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.leads WHERE id = lead AND observation IS NULL
      AND status = 'PROPOSTA' AND crm_external_id = 'CRM-123'
  ) THEN
    RAISE EXCEPTION 'The lead state is incorrect';
  END IF;
  DELETE FROM public.leads WHERE id = lead;
  DELETE FROM public.user_roles WHERE user_id = manager;

  IF (SELECT count(*) FROM private.lead_observation_audit) <> 2 OR
     NOT EXISTS (
       SELECT 1 FROM private.lead_observation_audit
       WHERE lead_id = lead AND actor_id = manager
         AND changed_at >= transaction_timestamp()
         AND previous_observation = 'Legado' AND new_observation = 'Nova'
     ) OR NOT EXISTS (
       SELECT 1 FROM private.lead_observation_audit
       WHERE lead_id = lead AND actor_id = manager
         AND changed_at >= transaction_timestamp()
         AND previous_observation = 'Nova' AND new_observation IS NULL
     ) THEN
    RAISE EXCEPTION 'Audit history is incorrect';
  END IF;
END;
$$;
ROLLBACK;

