-- One phone number can be verified under only ONE organisation (tenant).
-- A partial unique index on the verified rows enforces this at the DB level:
-- once a number is verified for tenant A, no other tenant can verify the same
-- number. Pending (unverified) rows are not constrained, so multiple tenants can
-- still REQUEST an OTP, but only the first to verify wins.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_dialer_number_verified
  ON dialer_number_verifications (phone_number)
  WHERE verified = TRUE;
