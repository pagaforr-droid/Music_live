-- ============================================================================
-- TANDU MUSICOS / STAGE · Esquema Supabase para Administración de Usuarios,
-- Altas/Bajas, Gestión de Contraseñas y Permisos Granulares por Módulo
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Es 100% idempotente (puede ejecutarse múltiples veces sin pérdida de datos).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tandu_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'stage_musician'
    CHECK (role IN ('super_admin', 'studio_producer', 'live_engineer', 'stage_musician', 'content_editor', 'custom')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'suspended')),
  allowed_modules JSONB NOT NULL DEFAULT '["concert","setlists"]'::jsonb,
  password_hash TEXT DEFAULT '',
  password_salt TEXT DEFAULT '',
  password_updated_at TIMESTAMPTZ DEFAULT now(),
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  deactivation_reason TEXT,
  created_by TEXT DEFAULT 'admin@tandu.com',
  is_system_owner BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.tandu_user_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  target_email TEXT NOT NULL,
  target_name TEXT NOT NULL,
  actor_email TEXT NOT NULL DEFAULT 'admin@tandu.com',
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tandu_users_email ON public.tandu_users(lower(email));
CREATE INDEX IF NOT EXISTS idx_tandu_users_status ON public.tandu_users(status);
CREATE INDEX IF NOT EXISTS idx_tandu_user_audit_created ON public.tandu_user_audit_logs(created_at DESC);

ALTER TABLE public.tandu_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tandu_user_audit_logs ENABLE ROW LEVEL SECURITY;

-- Lectura para validación de estado y módulos en login y sesión activa
DROP POLICY IF EXISTS "Read tandu_users" ON public.tandu_users;
CREATE POLICY "Read tandu_users" ON public.tandu_users
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Write tandu_users" ON public.tandu_users;
CREATE POLICY "Write tandu_users" ON public.tandu_users
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Read tandu_user_audit_logs" ON public.tandu_user_audit_logs;
CREATE POLICY "Read tandu_user_audit_logs" ON public.tandu_user_audit_logs
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Write tandu_user_audit_logs" ON public.tandu_user_audit_logs;
CREATE POLICY "Write tandu_user_audit_logs" ON public.tandu_user_audit_logs
  FOR ALL USING (true) WITH CHECK (true);

-- Semilla garantizada para el Super Administrador principal
INSERT INTO public.tandu_users (
  email,
  full_name,
  title,
  role,
  status,
  allowed_modules,
  must_change_password,
  notes,
  is_system_owner
) VALUES (
  'admin@tandu.com',
  'Administrador Principal TANDU',
  'Director General & Super Admin',
  'super_admin',
  'active',
  '["concert","setlists","soundcheck","studio","mastering","sample_lab","editor","lyrics","design","nacion_cms","mobile_inear","users_admin"]'::jsonb,
  false,
  'Cuenta maestra del sistema con acceso total.',
  true
)
ON CONFLICT (email) DO UPDATE SET
  role = 'super_admin',
  status = 'active',
  is_system_owner = true;
