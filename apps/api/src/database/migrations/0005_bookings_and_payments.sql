-- Bookings, the pro-bono waitlist, the shop, the payment ledger and client strikes.
-- Money is money_minor (cents). Every balance is derived (views at the bottom), never stored.

-- Pro-bono applications. The contact is created at submission, so name and phone live there.
-- Sensitive: self-reported health and financial details; never exposed to Ask Remedist.
-- Lifecycle: pending (submitted) -> waitlisted (Part 2 done) -> scheduled (booking made)
-- -> cancelled (missed reminders) | declined (staff). The booking points at the entry.
CREATE TABLE probono_entries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id            UUID NOT NULL REFERENCES contacts (id),
  age                   INTEGER CHECK (age BETWEEN 0 AND 130),
  location              TEXT,
  problem_description   TEXT NOT NULL,
  financial_context     TEXT,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                          'pending', 'waitlisted', 'scheduled', 'cancelled', 'declined')),
  submitted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  reminder_count        INTEGER NOT NULL DEFAULT 0 CHECK (reminder_count >= 0),
  last_reminder_sent_at TIMESTAMPTZ,
  part2_completed_at    TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX probono_entries_contact_id_idx ON probono_entries (contact_id);
CREATE INDEX probono_entries_status_idx ON probono_entries (status, submitted_at);
CREATE TRIGGER probono_entries_updated_at BEFORE UPDATE ON probono_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE bookings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      UUID NOT NULL REFERENCES contacts (id),
  slot_id         UUID NOT NULL REFERENCES availability_slots (id),
  -- Copied from the slot, like the price.
  practitioner_id UUID NOT NULL REFERENCES practitioners (id),
  slot_start      TIMESTAMPTZ NOT NULL,
  slot_end        TIMESTAMPTZ NOT NULL,
  -- Set once at creation and never changed by a reschedule: the anchor for the self-service
  -- reschedule's 30-day window.
  original_slot_start     TIMESTAMPTZ NOT NULL,
  -- NULL while the client's one self-service reschedule is unused. Staff reschedules never set it.
  self_reschedule_used_at TIMESTAMPTZ,
  residency          TEXT NOT NULL CHECK (residency IN ('lk', 'intl')),
  -- What this booking costs, fixed at booking time from the slot and the client's nationality.
  rate_charged_minor money_minor NOT NULL,
  currency           currency_code NOT NULL,
  status             TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'confirmed', 'cancelled', 'no_show')),
  notes              TEXT, -- the client's own words from the booking form; never overwritten by staff
  staff_notes        TEXT, -- staff commentary from the CRM
  -- A checkout hold lasts 15 minutes and is released by the 1-minute job.
  hold_expires_at    TIMESTAMPTZ,
  google_event_id    TEXT,
  booking_type       TEXT NOT NULL DEFAULT 'paid' CHECK (booking_type IN ('paid', 'probono')),
  appointment_code   TEXT, -- current code (e.g. 02AUG26-PM03); earlier ones in appointment_code_history
  probono_entry_id   UUID REFERENCES probono_entries (id),
  -- Fixed at creation: the client's Pay Now / Pay After choice (or the contact's setting).
  payment_mode       TEXT NOT NULL DEFAULT 'upfront' CHECK (payment_mode IN ('upfront', 'pay_after')),
  -- Day 0 of the payment-reminder clock; reset by every partial payment.
  payment_reminder_anchor_at    TIMESTAMPTZ,
  last_payment_reminder_sent_at TIMESTAMPTZ,
  -- Dedupes the one-time "30 days overdue" CRM notification.
  overdue_notified_at           TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (slot_end > slot_start),
  CHECK (status <> 'held' OR hold_expires_at IS NOT NULL),
  CHECK (probono_entry_id IS NULL OR booking_type = 'probono')
);
-- Backstop only: claiming the slot (UPDATE ... WHERE status = 'open', one row changed) is what
-- prevents double-booking.
CREATE UNIQUE INDEX bookings_slot_id_active_key ON bookings (slot_id) WHERE status IN ('held', 'confirmed');
CREATE UNIQUE INDEX bookings_appointment_code_key ON bookings (appointment_code) WHERE appointment_code IS NOT NULL;
CREATE UNIQUE INDEX bookings_probono_entry_id_key ON bookings (probono_entry_id) WHERE probono_entry_id IS NOT NULL;
CREATE INDEX bookings_slot_id_idx ON bookings (slot_id);
CREATE INDEX bookings_practitioner_id_idx ON bookings (practitioner_id, slot_start);
CREATE INDEX bookings_contact_id_idx ON bookings (contact_id, slot_start DESC);
CREATE INDEX bookings_active_slot_start_idx ON bookings (slot_start) WHERE status IN ('held', 'confirmed');
CREATE INDEX bookings_hold_expires_at_idx ON bookings (hold_expires_at) WHERE status = 'held';
CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every appointment code a booking has had. A reschedule issues a new code and keeps the old one here.
CREATE TABLE appointment_code_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    UUID NOT NULL REFERENCES bookings (id),
  code          TEXT NOT NULL,
  superseded_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX appointment_code_history_booking_id_idx ON appointment_code_history (booking_id);

-- One row per strike: a no-show, or a late cancellation of a confirmed booking.
-- The count is always COUNT(*) here.
CREATE TABLE contact_strikes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts (id),
  booking_id UUID REFERENCES bookings (id),
  type       TEXT NOT NULL CHECK (type IN ('no_show', 'late_cancellation')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contact_strikes_contact_id_idx ON contact_strikes (contact_id, created_at);
-- A booking produces at most one strike of each kind.
CREATE UNIQUE INDEX contact_strikes_booking_type_key ON contact_strikes (booking_id, type) WHERE booking_id IS NOT NULL;

-- ── Shop ─────────────────────────────────────────────────────────────────────────────────

-- photo_url is a pasted link; there is no upload pipeline for products.
CREATE TABLE products (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  description         TEXT,
  price_minor         money_minor NOT NULL,
  currency            currency_code NOT NULL,
  photo_url           TEXT,
  stock_count         INTEGER NOT NULL DEFAULT 0 CHECK (stock_count >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE shop_orders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts (id),
  currency   currency_code NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX shop_orders_contact_id_idx ON shop_orders (contact_id, created_at);

-- Line items keep the name and price as sold (a snapshot) and the link to the product.
-- The order total is SUM(quantity * unit_price_minor).
CREATE TABLE shop_order_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID NOT NULL REFERENCES shop_orders (id),
  product_id       UUID NOT NULL REFERENCES products (id),
  product_name     TEXT NOT NULL,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_minor money_minor NOT NULL,
  UNIQUE (order_id, product_id)
);
CREATE INDEX shop_order_items_product_id_idx ON shop_order_items (product_id);

-- ── Payment ledger ───────────────────────────────────────────────────────────────────────

-- Money that came in, or was attempted. Any method, many per booking: a failed PayHere attempt
-- and its retry are two rows. A pro-bono booking gets a $0 'waived' row.
CREATE TABLE payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id          UUID NOT NULL REFERENCES contacts (id),
  method              TEXT NOT NULL CHECK (method IN ('payhere', 'cash', 'bank_transfer', 'card_terminal', 'waived')),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled', 'refunded')),
  amount_minor        money_minor NOT NULL,
  currency            currency_code NOT NULL,
  provider_ref        TEXT UNIQUE, -- PayHere order id
  provider_payment_id TEXT,
  provider_payload    JSONB,       -- the verified notify fields, as received
  received_at         TIMESTAMPTZ,
  recorded_by         UUID REFERENCES auth.staff_users (id), -- NULL for PayHere
  invoice_number      TEXT UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (method <> 'payhere' OR provider_ref IS NOT NULL),
  CHECK (method = 'payhere' OR recorded_by IS NOT NULL OR method = 'waived'),
  CHECK (status <> 'succeeded' OR received_at IS NOT NULL),
  CHECK (method <> 'waived' OR amount_minor = 0)
);
CREATE INDEX payments_contact_id_idx ON payments (contact_id, created_at);
CREATE INDEX payments_recorded_by_idx ON payments (recorded_by);
CREATE INDEX payments_status_idx ON payments (status, created_at) WHERE status = 'pending';
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Client credit as a ledger: the balance is SUM(amount_minor) per currency. Overpayments add,
-- applying credit to a booking subtracts, and year-end expiry is a negative 'expired' row.
CREATE TABLE credit_transactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id   UUID NOT NULL REFERENCES contacts (id),
  amount_minor BIGINT NOT NULL CHECK (amount_minor <> 0),
  currency     currency_code NOT NULL,
  reason       TEXT NOT NULL CHECK (reason IN ('overpayment', 'applied', 'expired', 'manual')),
  payment_id   UUID REFERENCES payments (id),
  expires_at   TIMESTAMPTZ,
  created_by   UUID REFERENCES auth.staff_users (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (reason NOT IN ('overpayment') OR (amount_minor > 0 AND payment_id IS NOT NULL)),
  CHECK (reason NOT IN ('applied', 'expired') OR amount_minor < 0),
  CHECK (reason <> 'manual' OR created_by IS NOT NULL)
);
CREATE INDEX credit_transactions_contact_id_idx ON credit_transactions (contact_id, currency);
CREATE INDEX credit_transactions_payment_id_idx ON credit_transactions (payment_id);
CREATE INDEX credit_transactions_created_by_idx ON credit_transactions (created_by);

-- How money (a succeeded payment, or applied credit) was split across what's owed.
CREATE TABLE payment_allocations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id    UUID REFERENCES payments (id),
  credit_txn_id UUID REFERENCES credit_transactions (id),
  booking_id    UUID REFERENCES bookings (id),
  shop_order_id UUID REFERENCES shop_orders (id),
  amount_minor  BIGINT NOT NULL CHECK (amount_minor > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(payment_id, credit_txn_id) = 1),
  CHECK (num_nonnulls(booking_id, shop_order_id) = 1)
);
CREATE INDEX payment_allocations_payment_id_idx ON payment_allocations (payment_id);
CREATE INDEX payment_allocations_credit_txn_id_idx ON payment_allocations (credit_txn_id);
CREATE INDEX payment_allocations_booking_id_idx ON payment_allocations (booking_id);
CREATE INDEX payment_allocations_shop_order_id_idx ON payment_allocations (shop_order_id);

-- Amounts forgiven by staff. Not money, so not a payment.
CREATE TABLE booking_adjustments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   UUID NOT NULL REFERENCES bookings (id),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  reason       TEXT NOT NULL CHECK (reason IN ('discount', 'probono_waiver', 'write_off')),
  note         TEXT,
  created_by   UUID NOT NULL REFERENCES auth.staff_users (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX booking_adjustments_booking_id_idx ON booking_adjustments (booking_id);
CREATE INDEX booking_adjustments_created_by_idx ON booking_adjustments (created_by);

-- ── Derived balances: every screen and Ask Remedist read the same numbers ────────────────

-- Amount due = max(0, rate charged - money allocated - amounts forgiven). Only succeeded
-- payments count; a refunded payment's allocations drop out automatically.
CREATE VIEW booking_balances AS
SELECT
  b.id                                     AS booking_id,
  b.contact_id,
  b.currency,
  b.rate_charged_minor,
  COALESCE(paid.amount, 0)::BIGINT         AS paid_minor,
  COALESCE(adjusted.amount, 0)::BIGINT     AS adjusted_minor,
  GREATEST(b.rate_charged_minor - COALESCE(paid.amount, 0) - COALESCE(adjusted.amount, 0), 0)::BIGINT AS due_minor
FROM bookings b
LEFT JOIN (
  SELECT pa.booking_id, SUM(pa.amount_minor) AS amount
  FROM payment_allocations pa
  LEFT JOIN payments p ON p.id = pa.payment_id
  WHERE pa.booking_id IS NOT NULL
    AND (pa.credit_txn_id IS NOT NULL OR p.status = 'succeeded')
  GROUP BY pa.booking_id
) paid ON paid.booking_id = b.id
LEFT JOIN (
  SELECT booking_id, SUM(amount_minor) AS amount
  FROM booking_adjustments
  GROUP BY booking_id
) adjusted ON adjusted.booking_id = b.id;

CREATE VIEW contact_credit_balances AS
SELECT contact_id, currency, SUM(amount_minor)::BIGINT AS balance_minor
FROM credit_transactions
GROUP BY contact_id, currency;

CREATE VIEW shop_order_totals AS
SELECT o.id AS order_id, o.contact_id, o.currency,
       COALESCE(SUM(i.quantity * i.unit_price_minor), 0)::BIGINT AS total_minor
FROM shop_orders o
LEFT JOIN shop_order_items i ON i.order_id = o.id
GROUP BY o.id;
