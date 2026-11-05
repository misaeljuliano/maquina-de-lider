-- Keep delivery state private to the Worker service role.
CREATE TABLE IF NOT EXISTS public.seller_onboarding (
  seller_id uuid PRIMARY KEY REFERENCES public.sellers(id) ON DELETE CASCADE,
  email_status text NOT NULL DEFAULT 'pending'
    CHECK (email_status IN ('pending', 'sent', 'failed')),
  whatsapp_status text NOT NULL DEFAULT 'pending'
    CHECK (whatsapp_status IN ('pending', 'sent', 'failed')),
  email_error text,
  whatsapp_error text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.seller_onboarding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.seller_onboarding FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.seller_onboarding TO service_role;
