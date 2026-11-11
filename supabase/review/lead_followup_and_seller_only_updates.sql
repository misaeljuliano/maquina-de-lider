
-- Applied to Supabase staging on 2026-11-10; not applied to production.
-- Review snapshot for lead follow-up data and seller-only direct updates.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS next_step text,
  ADD COLUMN IF NOT EXISTS next_contact_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_interaction_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_interaction_type text;

-- Authenticated users previously had column-level UPDATE grants on most lead
-- fields. Revoke table and column grants, then grant only the fields the seller
-- wallet is allowed to change directly. Manager-only fields remain writable
-- through the existing SECURITY DEFINER functions.
REVOKE UPDATE ON TABLE public.leads FROM PUBLIC, anon, authenticated;
DO $revoke_column_updates$
DECLARE
  v_column record;
BEGIN
  FOR v_column IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'leads'
  LOOP
    EXECUTE format(
      'REVOKE UPDATE (%I) ON TABLE public.leads FROM PUBLIC, anon, authenticated',
      v_column.column_name
    );
  END LOOP;
END;
$revoke_column_updates$;

GRANT UPDATE (status, next_step, next_contact_at)
  ON TABLE public.leads TO authenticated;

DROP POLICY IF EXISTS leads_update_scoped ON public.leads;
CREATE POLICY leads_update_scoped
ON public.leads
FOR UPDATE
TO authenticated
USING (
  private.can_access_seller(seller_id)
  AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'VENDEDOR'::public.app_role
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN (
        'GERENTE'::public.app_role,
        'EXECUTIVO'::public.app_role,
        'SUPERVISOR'::public.app_role
      )
  )
)
WITH CHECK (
  private.can_access_seller(seller_id)
  AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'VENDEDOR'::public.app_role
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN (
        'GERENTE'::public.app_role,
        'EXECUTIVO'::public.app_role,
        'SUPERVISOR'::public.app_role
      )
  )
);

CREATE OR REPLACE FUNCTION private.capture_lead_status_interaction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.last_interaction_at := pg_catalog.now();
    NEW.last_interaction_type := 'STATUS:' || NEW.status::text;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.capture_lead_status_interaction()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS leads_capture_status_interaction ON public.leads;
CREATE TRIGGER leads_capture_status_interaction
BEFORE UPDATE OF status ON public.leads
FOR EACH ROW
EXECUTE FUNCTION private.capture_lead_status_interaction();

GRANT SELECT (next_step, next_contact_at, last_interaction_at, last_interaction_type)
  ON TABLE public.leads TO authenticated;


