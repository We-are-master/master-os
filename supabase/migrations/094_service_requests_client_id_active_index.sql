-- Speed duplicate detection and other lookups by client on active service_requests.
CREATE INDEX IF NOT EXISTS idx_service_requests_client_id_active
  ON public.service_requests (client_id)
  WHERE deleted_at IS NULL;
