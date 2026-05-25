ALTER TABLE materials
  DROP CONSTRAINT IF EXISTS materials_source_mode_check;

ALTER TABLE materials
  ADD CONSTRAINT materials_source_mode_check
  CHECK (source_mode = ANY (ARRAY[
    'material'::text,
    'direction'::text,
    'chat'::text,
    'copy_rewrite'::text,
    'video_script'::text,
    'advice_only'::text
  ]));