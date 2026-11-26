-- Phone codes can verify a booking as well as a login (the old app's two phone OTP purposes).

ALTER TABLE auth.otp_requests DROP CONSTRAINT otp_requests_purpose_check;
ALTER TABLE auth.otp_requests ADD CONSTRAINT otp_requests_purpose_check
  CHECK (purpose IN ('login', 'admin_login', 'email_verification', 'password_reset', 'booking_verification'));
