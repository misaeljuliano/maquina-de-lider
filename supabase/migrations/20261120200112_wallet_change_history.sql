-- Only selected business fields are retained; credentials and tokens are never logged.
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT ON public.audit_log TO service_role;
CREATE OR REPLACE FUNCTION private.capture_wallet_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  before_row jsonb := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  after_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  fields text[];
  field_name text;
  changes jsonb := '{}'::jsonb;
  actor uuid := auth.uid();
  headers jsonb;
  actor_label text;
  entity uuid;
BEGIN
  IF TG_TABLE_NAME = 'leads' THEN
    fields := ARRAY['status','next_step','next_contact_at'];
  ELSIF TG_TABLE_NAME = 'sellers' THEN
    fields := ARRAY['name','phone','region','active','seller_user_id','supervisor_user_id','executive_user_id'];
  ELSIF TG_TABLE_NAME = 'supervisor_executives' THEN
    fields := ARRAY['supervisor_user_id','executive_user_id'];
  ELSIF TG_TABLE_NAME = 'user_roles' THEN
    fields := ARRAY['role'];
  ELSE
    fields := ARRAY['email'];
    IF TG_OP <> 'UPDATE' THEN RETURN NULL; END IF;
  END IF;
  FOREACH field_name IN ARRAY fields LOOP
    IF (before_row -> field_name) IS DISTINCT FROM (after_row -> field_name) THEN
      changes := changes || jsonb_build_object(field_name,
        jsonb_build_object('before',before_row -> field_name,'after',after_row -> field_name));
    END IF;
  END LOOP;
  IF changes = '{}'::jsonb THEN RETURN NULL; END IF;
  -- The header is trusted only for requests authenticated by the server's service key.
  IF auth.role() = 'service_role' THEN
    headers := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
    IF coalesce(headers ->> 'x-wallet-actor','') ~* '^[0-9a-f-]{36}$' THEN
      actor := (headers ->> 'x-wallet-actor')::uuid;
    END IF;
  END IF;
  SELECT email INTO actor_label FROM auth.users WHERE id=actor;
  entity := coalesce(after_row ->> 'id',before_row ->> 'id',
    after_row ->> 'user_id',before_row ->> 'user_id',
    after_row ->> 'supervisor_user_id',before_row ->> 'supervisor_user_id')::uuid;
  INSERT INTO public.audit_log(actor_user_id,action,entity_type,entity_id,metadata)
  VALUES(actor,TG_OP,TG_TABLE_NAME,entity,jsonb_build_object(
    'label',coalesce(after_row ->> 'name',before_row ->> 'name',after_row ->> 'email',before_row ->> 'email',TG_TABLE_NAME),
    'actor_email',coalesce(actor_label,'Operação administrativa'),
    'changes',changes));
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION private.capture_wallet_change() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER wallet_history_leads AFTER UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION private.capture_wallet_change();
CREATE TRIGGER wallet_history_sellers AFTER INSERT OR UPDATE OR DELETE ON public.sellers FOR EACH ROW EXECUTE FUNCTION private.capture_wallet_change();
CREATE TRIGGER wallet_history_links AFTER INSERT OR DELETE ON public.supervisor_executives FOR EACH ROW EXECUTE FUNCTION private.capture_wallet_change();
CREATE TRIGGER wallet_history_roles AFTER INSERT OR UPDATE OR DELETE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION private.capture_wallet_change();
CREATE TRIGGER wallet_history_email AFTER UPDATE OF email ON auth.users FOR EACH ROW EXECUTE FUNCTION private.capture_wallet_change();
CREATE INDEX IF NOT EXISTS audit_log_created_id_idx ON public.audit_log(created_at DESC,id DESC);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
REVOKE INSERT,UPDATE,DELETE ON public.audit_log FROM anon,authenticated;
