ALTER TABLE users ADD COLUMN email_hash TEXT;
ALTER TABLE users ADD COLUMN encrypted_email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_hash ON users(email_hash);
