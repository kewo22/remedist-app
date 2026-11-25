// Tunable settings for the Postgres connection pools.

// Max connections the app opens through Neon's pooler (PgBouncer). Neon multiplexes
// these onto real Postgres connections, so this only caps concurrency per instance.
export const POOL_MAX_CONNECTIONS = 10;

// Give up on getting a connection after this long. Neon computes that are scaled to
// zero take a second or two to wake, so this is generous on purpose.
export const POOL_CONNECTION_TIMEOUT_MS = 10_000;

// Close idle connections after this long so a sleeping Neon compute can scale down.
export const POOL_IDLE_TIMEOUT_MS = 30_000;

// The direct (non-pooled) URL is only used for migrations and job locks, so it needs
// very few connections.
export const DIRECT_POOL_MAX_CONNECTIONS = 2;

// The startup check retries a few times so a cold Neon compute doesn't fail the boot.
export const STARTUP_CONNECT_ATTEMPTS = 3;
export const STARTUP_CONNECT_RETRY_DELAY_MS = 2_000;
