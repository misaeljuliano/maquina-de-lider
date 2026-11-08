-- Evaluate auth.uid() once per statement in these RLS policies.
ALTER POLICY user_roles_select_own
  ON public.user_roles
  USING (user_id = (SELECT auth.uid()));

-- Some environments do not include the audit_log table/policy.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'audit_log'
      AND policyname = 'audit_log_select_manager'
  ) THEN
    EXECUTE 'ALTER POLICY audit_log_select_manager ON public.audit_log USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = (SELECT auth.uid()) AND ur.role = ''GERENTE''::public.app_role))';
  END IF;
END
$migration$;
