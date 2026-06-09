-- Migration 219: Smart Price flag, job band label for Zendesk webhook

ALTER TABLE public.service_catalog
  ADD COLUMN IF NOT EXISTS accepts_smart_price boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.service_catalog.accepts_smart_price IS
  'When true, service can be booked as Smart Price (hourly). When false, hourly path is not offered.';

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS catalog_band_label text NULL;

COMMENT ON COLUMN public.jobs.catalog_band_label IS
  'Denormalized pricing band label at job creation (from service_catalog.pricing_presets).';
