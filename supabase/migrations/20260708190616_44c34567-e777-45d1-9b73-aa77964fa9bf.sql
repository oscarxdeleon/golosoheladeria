
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS command_formats jsonb NOT NULL DEFAULT jsonb_build_object(
    'clasico', jsonb_build_object(
      'label', 'Clásico',
      'font', 'A',
      'titleSize', 2, 'productSize', 1, 'modifierSize', 1,
      'bold', jsonb_build_object('title', true, 'product', true, 'modifier', false),
      'align', jsonb_build_object('header', 'center', 'product', 'left', 'orderType', 'center'),
      'separator', jsonb_build_object('char', '-', 'blankLines', 0),
      'lineSpacing', 0,
      'margins', jsonb_build_object('left', 0, 'right', 0),
      'modifiersLayout', 'inline',
      'quantityFormat', 'x',
      'orderNumberFormat', 'hash',
      'tableFormat', 'MESA N',
      'orderTypeFormat', 'prefix'
    ),
    'compacto', jsonb_build_object(
      'label', 'Compacto',
      'font', 'B',
      'titleSize', 1, 'productSize', 1, 'modifierSize', 1,
      'bold', jsonb_build_object('title', true, 'product', true, 'modifier', false),
      'align', jsonb_build_object('header', 'left', 'product', 'left', 'orderType', 'left'),
      'separator', jsonb_build_object('char', '-', 'blankLines', 0),
      'lineSpacing', 0,
      'margins', jsonb_build_object('left', 0, 'right', 0),
      'modifiersLayout', 'inline',
      'quantityFormat', 'x',
      'orderNumberFormat', 'hash',
      'tableFormat', 'MN',
      'orderTypeFormat', 'prefix'
    ),
    'grande', jsonb_build_object(
      'label', 'Grande / Legible',
      'font', 'A',
      'titleSize', 3, 'productSize', 2, 'modifierSize', 1,
      'bold', jsonb_build_object('title', true, 'product', true, 'modifier', true),
      'align', jsonb_build_object('header', 'center', 'product', 'left', 'orderType', 'center'),
      'separator', jsonb_build_object('char', '=', 'blankLines', 1),
      'lineSpacing', 1,
      'margins', jsonb_build_object('left', 1, 'right', 1),
      'modifiersLayout', 'list',
      'quantityFormat', 'times',
      'orderNumberFormat', 'pedido',
      'tableFormat', 'MESA N',
      'orderTypeFormat', 'arrow'
    )
  ),
  ADD COLUMN IF NOT EXISTS command_format_active text NOT NULL DEFAULT 'clasico';
