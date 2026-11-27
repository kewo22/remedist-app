-- A client changing the mobile number on their portal profile proves the new number with a phone
-- code (purpose 'phone_change'), because that number receives sign-in and password reset codes.
ALTER TABLE auth.otp_requests DROP CONSTRAINT otp_requests_purpose_check;
ALTER TABLE auth.otp_requests ADD CONSTRAINT otp_requests_purpose_check
  CHECK (purpose IN ('login', 'admin_login', 'email_verification', 'password_reset', 'booking_verification', 'phone_change'));

-- contacts.gender was free text. The Part 1 form only ever sent M or F (CONTACT_GENDERS).
ALTER TABLE contacts ADD CONSTRAINT contacts_gender_check CHECK (gender IN ('M', 'F'));

-- The CRM client list shows the most recently touched contacts first.
CREATE INDEX contacts_updated_at_idx ON contacts (updated_at DESC);
