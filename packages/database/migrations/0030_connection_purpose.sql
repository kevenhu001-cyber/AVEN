-- Separate commit: PostgreSQL enum values must be committed before use.
ALTER TYPE public.consent_purpose ADD VALUE IF NOT EXISTS 'connection_invitation';
