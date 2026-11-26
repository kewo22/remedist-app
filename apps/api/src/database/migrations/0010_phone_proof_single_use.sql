-- A passed phone check issues a proof token (the phoneVerificationToken) that names its code row.
-- The step that relies on it (phone sign-in) marks the row here, so each proof works only once.

ALTER TABLE auth.otp_requests ADD COLUMN proof_used_at TIMESTAMPTZ;
ALTER TABLE auth.otp_requests ADD CONSTRAINT otp_requests_proof_used_check
  CHECK (proof_used_at IS NULL OR status = 'verified');
