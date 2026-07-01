
-- 1. Loyalty settings columns
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS loyalty_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS loyalty_points_per_1000 integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS loyalty_point_value numeric(10,2) NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS loyalty_min_redeem integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS loyalty_expiration_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loyalty_welcome_text text;

-- 2. Update the loyalty trigger to respect config
CREATE OR REPLACE FUNCTION public.apply_customer_loyalty()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  pts integer;
  cfg_enabled boolean;
  cfg_per_1000 integer;
BEGIN
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.status,'completed') IN ('pending','cancelled') THEN RETURN NEW; END IF;

  SELECT COALESCE(loyalty_enabled,true), COALESCE(loyalty_points_per_1000,1)
    INTO cfg_enabled, cfg_per_1000
    FROM public.settings LIMIT 1;

  IF NOT COALESCE(cfg_enabled,true) THEN RETURN NEW; END IF;

  pts := floor(COALESCE(NEW.total,0) / 1000)::int * COALESCE(cfg_per_1000,1);
  UPDATE public.customers
    SET points = COALESCE(points,0) + pts,
        total_spent = COALESCE(total_spent,0) + COALESCE(NEW.total,0),
        visits = COALESCE(visits,0) + 1,
        updated_at = now()
    WHERE id = NEW.customer_id;
  RETURN NEW;
END $function$;

-- 3. Public loyalty lookup by phone (no auth)
CREATE OR REPLACE FUNCTION public.lookup_customer_loyalty(_phone text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _norm text;
  _cust public.customers;
  _cfg record;
  _recent jsonb;
  _point_value numeric;
  _min_redeem integer;
  _redeemable_pts integer;
  _redeemable_money numeric;
BEGIN
  _norm := NULLIF(regexp_replace(COALESCE(_phone,''),'[^0-9]','','g'),'');
  IF _norm IS NULL OR length(_norm) < 7 THEN
    RETURN jsonb_build_object('found', false, 'error', 'Ingresa un teléfono válido');
  END IF;

  SELECT COALESCE(loyalty_enabled,true) AS enabled,
         COALESCE(loyalty_point_value,10) AS point_value,
         COALESCE(loyalty_min_redeem,100) AS min_redeem,
         COALESCE(loyalty_points_per_1000,1) AS per_1000,
         COALESCE(loyalty_welcome_text,'') AS welcome
    INTO _cfg
    FROM public.settings LIMIT 1;

  IF NOT COALESCE(_cfg.enabled,true) THEN
    RETURN jsonb_build_object('found', false, 'error', 'Programa de fidelización desactivado');
  END IF;

  SELECT * INTO _cust
    FROM public.customers
   WHERE regexp_replace(COALESCE(phone,''),'[^0-9]','','g') = _norm
   LIMIT 1;

  IF _cust.id IS NULL THEN
    RETURN jsonb_build_object(
      'found', false,
      'config', jsonb_build_object(
        'point_value', _cfg.point_value,
        'min_redeem', _cfg.min_redeem,
        'per_1000', _cfg.per_1000,
        'welcome', _cfg.welcome
      )
    );
  END IF;

  _point_value := _cfg.point_value;
  _min_redeem := _cfg.min_redeem;
  _redeemable_pts := CASE WHEN COALESCE(_cust.points,0) >= _min_redeem THEN _cust.points ELSE 0 END;
  _redeemable_money := _redeemable_pts * _point_value;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ticket', ticket_number,
    'total', total,
    'created_at', created_at,
    'points_earned', floor(COALESCE(total,0)/1000)::int * _cfg.per_1000
  ) ORDER BY created_at DESC), '[]'::jsonb)
    INTO _recent
    FROM (
      SELECT ticket_number, total, created_at
        FROM public.sales
       WHERE customer_id = _cust.id
         AND COALESCE(status,'completed') <> 'cancelled'
       ORDER BY created_at DESC
       LIMIT 10
    ) s;

  RETURN jsonb_build_object(
    'found', true,
    'customer', jsonb_build_object(
      'name', _cust.name,
      'phone', _cust.phone,
      'points', COALESCE(_cust.points,0),
      'visits', COALESCE(_cust.visits,0),
      'total_spent', COALESCE(_cust.total_spent,0),
      'last_order_at', _cust.last_order_at
    ),
    'redeemable', jsonb_build_object(
      'points', _redeemable_pts,
      'money', _redeemable_money,
      'min_redeem', _min_redeem,
      'point_value', _point_value
    ),
    'recent_orders', _recent,
    'config', jsonb_build_object(
      'point_value', _point_value,
      'min_redeem', _min_redeem,
      'per_1000', _cfg.per_1000,
      'welcome', _cfg.welcome
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.lookup_customer_loyalty(text) TO anon, authenticated;
