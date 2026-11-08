-- Speeds up seller-scoped wallet queries and lead-to-seller FK checks.
-- The same index is also missing in production and is safe to apply there
-- after the migration is reviewed and promoted through the normal release flow.
CREATE INDEX IF NOT EXISTS leads_seller_id_idx
  ON public.leads (seller_id);
