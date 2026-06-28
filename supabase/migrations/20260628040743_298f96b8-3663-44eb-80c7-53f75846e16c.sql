
-- Roles enum
CREATE TYPE public.app_role AS ENUM ('admin', 'cajero');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles read all auth" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles update self" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- User roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "roles read self" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "roles admin manage" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Auto create profile on signup; first user becomes admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  user_count INT;
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)));

  SELECT COUNT(*) INTO user_count FROM auth.users;
  IF user_count = 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'cajero');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Categories
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  color TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cat read" ON public.categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "cat admin write" ON public.categories FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Products
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  sku TEXT,
  image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prod read" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "prod admin write" ON public.products FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Modifier groups
CREATE TABLE public.modifier_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  min_select INT NOT NULL DEFAULT 0,
  max_select INT NOT NULL DEFAULT 1,
  required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.modifier_groups TO authenticated;
GRANT ALL ON public.modifier_groups TO service_role;
ALTER TABLE public.modifier_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mg read" ON public.modifier_groups FOR SELECT TO authenticated USING (true);
CREATE POLICY "mg admin write" ON public.modifier_groups FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.modifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.modifier_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.modifiers TO authenticated;
GRANT ALL ON public.modifiers TO service_role;
ALTER TABLE public.modifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mod read" ON public.modifiers FOR SELECT TO authenticated USING (true);
CREATE POLICY "mod admin write" ON public.modifiers FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Supplies (insumos)
CREATE TABLE public.supplies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'unidad',
  stock NUMERIC(12,2) NOT NULL DEFAULT 0,
  min_stock NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplies TO authenticated;
GRANT ALL ON public.supplies TO service_role;
ALTER TABLE public.supplies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sup read" ON public.supplies FOR SELECT TO authenticated USING (true);
CREATE POLICY "sup admin write" ON public.supplies FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Payment methods
CREATE TABLE public.payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_methods TO authenticated;
GRANT ALL ON public.payment_methods TO service_role;
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pm read" ON public.payment_methods FOR SELECT TO authenticated USING (true);
CREATE POLICY "pm admin write" ON public.payment_methods FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

INSERT INTO public.payment_methods (name, sort_order) VALUES ('Efectivo',1),('Nequi',2),('Bancolombia',3);

-- Printers
CREATE TABLE public.printers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  ip TEXT NOT NULL,
  port INT NOT NULL DEFAULT 9100,
  platform TEXT NOT NULL DEFAULT 'Windows',
  area TEXT NOT NULL DEFAULT 'caja',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.printers TO authenticated;
GRANT ALL ON public.printers TO service_role;
ALTER TABLE public.printers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pr read" ON public.printers FOR SELECT TO authenticated USING (true);
CREATE POLICY "pr admin write" ON public.printers FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Settings (singleton)
CREATE TABLE public.settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id=1),
  business_name TEXT NOT NULL DEFAULT 'Heladería Goloso',
  nit TEXT,
  address TEXT,
  city TEXT,
  phone TEXT,
  logo_url TEXT,
  menu_link TEXT,
  schedules JSONB NOT NULL DEFAULT '{"lun":{"open":true,"from":"10:00","to":"21:00"},"mar":{"open":true,"from":"10:00","to":"21:00"},"mie":{"open":true,"from":"10:00","to":"21:00"},"jue":{"open":true,"from":"10:00","to":"21:00"},"vie":{"open":true,"from":"10:00","to":"22:00"},"sab":{"open":true,"from":"10:00","to":"22:00"},"dom":{"open":true,"from":"12:00","to":"20:00"}}'::jsonb,
  delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "set read" ON public.settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "set admin write" ON public.settings FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
INSERT INTO public.settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Sales
CREATE SEQUENCE IF NOT EXISTS public.ticket_seq START 1000;

CREATE TABLE public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number INT NOT NULL DEFAULT nextval('public.ticket_seq'),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  user_name TEXT,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL,
  customer_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sales_created_idx ON public.sales(created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO authenticated;
GRANT ALL ON public.sales TO service_role;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales read all" ON public.sales FOR SELECT TO authenticated USING (true);
CREATE POLICY "sales insert self" ON public.sales FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sales admin update" ON public.sales FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "sales admin delete" ON public.sales FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  qty NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  modifiers JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX sale_items_sale_idx ON public.sale_items(sale_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_items TO authenticated;
GRANT ALL ON public.sale_items TO service_role;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "si read" ON public.sale_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "si insert" ON public.sale_items FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id AND s.user_id = auth.uid()));
CREATE POLICY "si admin delete" ON public.sale_items FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Seed catalog
DO $$
DECLARE
  cat_sabores UUID; cat_conos UUID; cat_copas UUID; cat_toppings UUID;
BEGIN
  INSERT INTO public.categories (name, sort_order, color) VALUES ('Sabores',1,'#FF8FAB') RETURNING id INTO cat_sabores;
  INSERT INTO public.categories (name, sort_order, color) VALUES ('Conos',2,'#FFB5A7') RETURNING id INTO cat_conos;
  INSERT INTO public.categories (name, sort_order, color) VALUES ('Copas',3,'#FFC8A2') RETURNING id INTO cat_copas;
  INSERT INTO public.categories (name, sort_order, color) VALUES ('Toppings',4,'#FFDDD2') RETURNING id INTO cat_toppings;

  INSERT INTO public.products (category_id, name, price) VALUES
    (cat_sabores,'Vainilla', 4500),
    (cat_sabores,'Chocolate', 4500),
    (cat_sabores,'Fresa', 4500),
    (cat_sabores,'Mora', 4500),
    (cat_sabores,'Arequipe', 5000),
    (cat_sabores,'Cookies & Cream', 5500),
    (cat_conos,'Cono Sencillo', 2000),
    (cat_conos,'Cono Galleta', 3500),
    (cat_copas,'Copa Pequeña', 7000),
    (cat_copas,'Copa Mediana', 10000),
    (cat_copas,'Banana Split', 15000),
    (cat_toppings,'Chispas de Chocolate', 1500),
    (cat_toppings,'Salsa de Fresa', 1500),
    (cat_toppings,'Maní', 1500),
    (cat_toppings,'Oreo', 2000);
END $$;
