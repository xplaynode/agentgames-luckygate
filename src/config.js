// Central configuration. Every secret comes from the environment — nothing
// sensitive is ever read from a file in this repo (see .env.example).
//
// Env vars:
//   AGENT_GAMES_HMAC_SECRET  Platform-issued HMAC secret (dashboard → agent →
//                            Rotate Secret). Primary name, per /build docs.
//   AGENT_GAMES_SECRET       Fallback alias for the same secret.
//   KURIER_API_KEY           Kurier mainnet API key (kurier.xyz dashboard).
//   KURIER_BASE_URL          Default https://api.kurier.xyz/api/v1
//   PORT                     Listen port for local/dev use (default 8080).
//                            In production the public URL must be plain HTTPS
//                            on 443 (platform rule: no custom ports) — put a
//                            tunnel/reverse proxy in front.
//   AGENT_PATH               Task handler path (default /agent). Register the
//                            FULL path on the dashboard, not just the origin.
//   VERIFIER_MODE            'mock' (default) or 'kurier'.
//   KURIER_SUBMIT            'async' (default when a key exists): submit our
//                            response proof to zkVerify via Kurier without
//                            blocking the 60 s response deadline.
//   STATE_FILE               Seen-set / idempotency persistence file.
//   CIRCUIT_SALT_SECRET      Optional separate secret for proof salt
//                            derivation; defaults to the HMAC secret.

export function loadConfig(env = process.env) {
  const secret = env.AGENT_GAMES_HMAC_SECRET || env.AGENT_GAMES_SECRET || '';
  return {
    port: Number(env.PORT || 8080),
    agentPath: env.AGENT_PATH || '/agent',
    hmacSecret: secret,
    usingPlaceholderSecret: secret.length === 0,
    kurierApiKey: env.KURIER_API_KEY || '',
    kurierBaseUrl: (env.KURIER_BASE_URL || 'https://api.kurier.xyz/api/v1').replace(/\/+$/, ''),
    verifierMode: env.VERIFIER_MODE || (env.KURIER_API_KEY ? 'kurier' : 'mock'),
    kurierSubmit: env.KURIER_SUBMIT || 'async',
    stateFile: env.STATE_FILE || new URL('../data/state.json', import.meta.url).pathname,
    saltSecret: env.CIRCUIT_SALT_SECRET || secret || 'local-dev-salt-secret',
    // Hard platform deadline is 60 s; keep our own budget safely below it.
    responseBudgetMs: Number(env.RESPONSE_BUDGET_MS || 50_000),
    proveTimeoutMs: Number(env.PROVE_TIMEOUT_MS || 30_000),
  };
}
