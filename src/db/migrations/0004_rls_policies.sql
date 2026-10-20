-- Druga linia obrony (BRIEF §5): Row Level Security z kontekstem ustawianym per transakcja:
--   app.current_org, app.current_user, app.current_role  (set_config(..., true) w withTenant()).
-- Brak kontekstu = brak wierszy (fail closed). Konto `app` nie jest właścicielem tabel, więc RLS go obowiązuje.
-- Właściciel (migrator) omija RLS: używany tylko przez migracje, CLI administracyjne i job retencji.

CREATE FUNCTION app_org() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.current_org', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_user() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.current_user', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_role() RETURNS text LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.current_role', true), '') $$;
--> statement-breakpoint
CREATE FUNCTION app_is_staff() RETURNS boolean LANGUAGE sql STABLE
AS $$ SELECT coalesce(app_role() IN ('admin', 'member', 'accountant'), false) $$;
--> statement-breakpoint
CREATE FUNCTION app_can_write() RETURNS boolean LANGUAGE sql STABLE
AS $$ SELECT coalesce(app_role() IN ('admin', 'member'), false) $$;
--> statement-breakpoint
CREATE FUNCTION app_is_admin() RETURNS boolean LANGUAGE sql STABLE
AS $$ SELECT coalesce(app_role() = 'admin', false) $$;
--> statement-breakpoint

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE contractor_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE contract_statements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE acceptances ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE retention_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Wzorzec: SELECT dla personelu i właściciela wiersza; zapis wg roli.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    -- tabela, warunek organizacji, warunek "własny wiersz", dodatkowy warunek UPDATE, warunek INSERT dla właściciela
    ('contracts', 'org_id = app_org()', 'contractor_id = app_user()', 'false', 'false'),
    ('contract_statements', 'EXISTS (SELECT 1 FROM contracts c WHERE c.id = contract_id)', 'true', 'false', 'true'),
    ('bills', 'org_id = app_org()',
       'EXISTS (SELECT 1 FROM contracts c WHERE c.id = contract_id AND c.contractor_id = app_user())',
       'app_role() = ''accountant''', 'false'),
    ('files', 'org_id = app_org()',
       $own$(owner_user_id = app_user()
          OR EXISTS (SELECT 1 FROM contracts c WHERE c.file_id = files.id)
          OR EXISTS (SELECT 1 FROM contract_statements s WHERE s.pdf_file_id = files.id)
          OR EXISTS (SELECT 1 FROM bills b WHERE b.pdf_file_id = files.id))$own$,
       'false', 'owner_user_id = app_user()'),
    ('contractor_profiles', 'org_id = app_org()', 'user_id = app_user()', 'false', 'user_id = app_user()')
  ) AS t(tbl, org_cond, own_cond, extra_upd, own_ins)
  LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING ((%s) AND (app_is_staff() OR (%s)))',
                   r.tbl || '_sel', r.tbl, r.org_cond, r.own_cond);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK ((%s) AND (app_can_write() OR (%s)))',
                   r.tbl || '_ins', r.tbl, r.org_cond, r.own_ins);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING ((%s) AND (app_can_write() OR (%s) OR (%s))) WITH CHECK ((%s) AND (app_can_write() OR (%s) OR (%s)))',
                   r.tbl || '_upd', r.tbl, r.org_cond, r.own_cond, r.extra_upd, r.org_cond, r.own_cond, r.extra_upd);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING ((%s) AND app_can_write())',
                   r.tbl || '_del', r.tbl, r.org_cond);
  END LOOP;
END
$$;
--> statement-breakpoint

-- organizations: odczyt własnej, zmiana tylko admin; tworzenie/usuwanie poza aplikacją.
CREATE POLICY organizations_sel ON organizations FOR SELECT USING (id = app_org());
--> statement-breakpoint
CREATE POLICY organizations_upd ON organizations FOR UPDATE
  USING (id = app_org() AND app_is_admin()) WITH CHECK (id = app_org() AND app_is_admin());
--> statement-breakpoint

-- memberships: własne wiersze (potrzebne przy logowaniu, zanim znamy org) oraz cała organizacja dla personelu.
CREATE POLICY memberships_sel ON memberships FOR SELECT
  USING (user_id = app_user() OR (org_id = app_org() AND app_is_staff()));
--> statement-breakpoint
CREATE POLICY memberships_ins ON memberships FOR INSERT WITH CHECK (org_id = app_org() AND app_can_write());
--> statement-breakpoint
CREATE POLICY memberships_upd ON memberships FOR UPDATE
  USING (org_id = app_org() AND app_can_write()) WITH CHECK (org_id = app_org() AND app_can_write());
--> statement-breakpoint
CREATE POLICY memberships_del ON memberships FOR DELETE USING (org_id = app_org() AND app_is_admin());
--> statement-breakpoint

-- acceptances: dopisywanie przez osobę akceptującą, niezmienne po zapisie (brak UPDATE/DELETE).
CREATE POLICY acceptances_sel ON acceptances FOR SELECT
  USING (org_id = app_org() AND (app_is_staff() OR user_id = app_user()));
--> statement-breakpoint
CREATE POLICY acceptances_ins ON acceptances FOR INSERT
  WITH CHECK (org_id = app_org() AND user_id = app_user());
--> statement-breakpoint

-- audit_log: zapis dla każdego kontekstu (także przed ustaleniem org), odczyt tylko admin własnej organizacji.
CREATE POLICY audit_log_sel ON audit_log FOR SELECT USING (org_id = app_org() AND app_is_admin());
--> statement-breakpoint
CREATE POLICY audit_log_ins ON audit_log FOR INSERT WITH CHECK (org_id IS NULL OR org_id = app_org());
--> statement-breakpoint

CREATE POLICY retention_jobs_sel ON retention_jobs FOR SELECT USING (org_id = app_org() AND app_is_admin());
--> statement-breakpoint

CREATE POLICY invitations_sel ON invitations FOR SELECT USING (org_id = app_org() AND app_can_write());
--> statement-breakpoint
CREATE POLICY invitations_ins ON invitations FOR INSERT WITH CHECK (org_id = app_org() AND app_can_write());
--> statement-breakpoint
CREATE POLICY invitations_del ON invitations FOR DELETE USING (org_id = app_org() AND app_can_write());
--> statement-breakpoint

-- Realizacja zaproszenia dzieje się bez sesji, więc tylko przez wąską funkcję SECURITY DEFINER
-- (właściciel omija RLS). Zwraca dane tylko dla ważnego, niewykorzystanego tokenu (po hashu).
CREATE FUNCTION invitation_lookup(p_token_hash text)
RETURNS TABLE (invitation_id uuid, org_id uuid, user_id uuid, role role)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT i.id, i.org_id, i.user_id, i.role
  FROM invitations i
  WHERE i.token_hash = p_token_hash AND i.used_at IS NULL AND i.expires_at > now()
$$;
--> statement-breakpoint
CREATE FUNCTION invitation_accept(p_token_hash text)
RETURNS TABLE (org_id uuid, user_id uuid, role role)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  inv invitations%ROWTYPE;
BEGIN
  UPDATE invitations SET used_at = now()
  WHERE token_hash = p_token_hash AND used_at IS NULL AND expires_at > now()
  RETURNING * INTO inv;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  UPDATE memberships SET status = 'active' WHERE memberships.user_id = inv.user_id AND memberships.org_id = inv.org_id;
  RETURN QUERY SELECT inv.org_id, inv.user_id, inv.role;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION invitation_lookup(text), invitation_accept(text) FROM PUBLIC;
--> statement-breakpoint

-- Uprawnienia konta aplikacji (rola tworzona w deploy/db-init.sh).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT EXECUTE ON FUNCTION invitation_lookup(text), invitation_accept(text) TO app;
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM app;
    REVOKE UPDATE, DELETE, TRUNCATE ON acceptances FROM app;
    REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM app;
  END IF;
END
$$;
