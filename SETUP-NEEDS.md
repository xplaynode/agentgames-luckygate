# SETUP-NEEDS — what a human must still do before this agent can compete

The agent itself is built and fully green locally (see README, `npm test`).
Four things stand between it and a scored round. None of them can be done
from this VM without the account owner.

## Blockers at a glance

| # | Blocker | Who | Time |
|---|---|---|---|
| 1 | Real HMAC secret (`AGENT_GAMES_HMAC_SECRET`) from the dashboard | User | 2 min |
| 2 | Public HTTPS hosting on port 443, URL registered in the dashboard | User picks option, agent deploys | 10–30 min |
| 3 | Kurier mainnet API key (optional but recommended) | User | 5 min |
| 4 | Dashboard steps: profile (GitHub + wallet), register agent, preflight, practice | User | 10 min |

---

## 1. The HMAC secret

The platform generates a 32-byte secret when an agent is registered and shows
it **exactly once** (and again once per rotation, under **Rotate Secret** on
the agent's settings page). Until the real value is in the agent's
environment as `AGENT_GAMES_HMAC_SECRET`, the platform's preflight fails with
a signature error and no task can be authenticated. It cannot be recovered
from anywhere else — if it is lost, rotate it (the old one stops working
immediately).

**Never paste it into a chat, a repo, or a prompt.** Hand it over through the
secure credential flow, or set it directly in the hosting environment.

## 2. Public HTTPS hosting (read this before choosing)

Platform constraints that shape the choice (from `/rules`):

- The registered URL must be **public HTTPS on the standard port — custom
  ports are rejected**, no localhost/private IPs.
- The platform POSTs to the URL **exactly as registered**, path included
  (register `https://…/agent`, not the bare origin).
- **Offline at delivery = forfeited task**, and uptime history is public.
  Rounds run nightly **18:30–04:30 WITA** (Gatekeeper, 13–20 Nov) — the host
  must be awake for that whole window, every night. Free tiers that sleep on
  inactivity are explicitly called out in the rules as a way to lose tasks.

Ranked options for THIS VM:

### Option A — Tailscale Funnel (recommended first try)
- What: this VM already has the `tailscale` CLI installed
  (`/opt/hatch/bin/tailscale`) and a Tailscale connector exists in this
  environment. Funnel exposes a local port at a stable
  `https://<machine>.<tailnet>.ts.net` URL on 443 with a real certificate.
- Pros: stable URL (survives restarts of the agent process), free, no domain
  or Cloudflare account needed, TLS handled.
- Cons: requires the Tailscale account owner to enable Funnel for the node
  (admin console: DNS + access controls), and the VM must stay joined to the
  tailnet. Funnel has bandwidth limits that are irrelevant at 8 tasks/night.
- Run shape: `tailscale funnel --bg 8080` next to `npm start`.

### Option B — Cloudflare Tunnel, named tunnel (best long-term)
- What: `cloudflared` (free single binary; not yet installed here) with a
  named tunnel bound to a hostname on a domain the user controls in
  Cloudflare DNS.
- Pros: most robust and permanent; stable custom hostname; Cloudflare edge
  TLS on 443; survives VM restarts if cloudflared is supervised.
- Cons: needs a Cloudflare account **and a domain on Cloudflare** — the only
  option with a hard external prerequisite. Quick tunnels (below) avoid the
  account but lose the stable URL.

### Option C — Cloudflare quick tunnel (`cloudflared tunnel --url localhost:8080`)
- What: zero-signup tunnel; assigns a random `*.trycloudflare.com` URL.
- Pros: works in two minutes, fine for a first preflight/practice session.
- Cons: **new URL on every restart** — the registered endpoint would change,
  requiring a dashboard edit each time; no uptime guarantees. Use only to
  smoke-test preflight before committing to A or B. Not viable for scored
  rounds across 8 nights.

### Option D — small VPS / PaaS with the agent behind a reverse proxy
- What: any always-on host (a $4–6 VPS, or a PaaS container) running the
  agent behind Caddy/nginx terminating TLS on 443.
- Pros: independent of this VM's lifetime; boring and reliable.
- Cons: needs an account/payment and a domain (or a provider hostname);
  more moving parts. PaaS free tiers that sleep are disqualified by the
  uptime rule — paid tier only.

**Recommendation:** Funnel (A) tonight if the tailnet admin step is quick —
it is the shortest path to a stable registered URL; named Cloudflare tunnel
(B) as the permanent home if a domain is available. Either way, keep the
agent process supervised (restart on crash) and confirm the public health
endpoint answers before registering the URL.

## 3. Kurier mainnet API key (optional, recommended)

Why: lets the agent submit each response proof to zkVerify as an on-chain
audit trail and poll it to Finalized (the build guide's recommended path).
The agent competes without it (proofs ride inside the responses), but the
audit trail is dispute evidence and the reliability story is stronger with
it. Set `KURIER_API_KEY` + `VERIFIER_MODE=kurier` to enable; the code path
is implemented and unit-tested.

Exact steps (verified against kurier.xyz and docs.zkverify.io, 2026-11-14):

1. Go to **https://kurier.xyz** — the **Mainnet** signup form on the homepage
   ("Sign up for your API key").
2. Fill in **Name**, **Company** (any project name is fine), **Email**,
   **Password**; accept the Terms of Use / Privacy Policy; submit.
3. Verify the email if asked, then **Log In**.
4. In the user dashboard, open the API-key section and **generate/copy the
   mainnet API key** (docs: "users can obtain an API key by creating an
   account at kurier.xyz and generating a key from the user dashboard").
5. Hand the key over via the secure credential flow — never in chat. It
   becomes `KURIER_API_KEY` in the agent's environment.

Cost: **the key is free** — Kurier's own homepage says "Sign up and generate
your free API key", and no pricing is published. Rate limits exist; the docs
say power users can ask on the zkVerify Discord or via their form for a
raise, naming their use case. At 8 tasks/night we are nowhere near any sane
limit. (Testnet keys come from the same site with the testnet toggle and use
`https://api-testnet.kurier.xyz/api/v1` — only needed for dry runs.)

Alternative (not needed now): zkVerifyJS with a funded Volta/mainnet account
(seed phrase + VFY for fees). More moving parts and a hot wallet key to
protect; Kurier exists precisely to avoid that.

## 4. Dashboard steps for the user (in order)

Do these in the agentgames.zkverify.io dashboard, signed in with the X
account used at registration:

1. **Profile** — set your public handle, country, short bio.
2. **Profile → connect GitHub** (the account that owns your code) **and add
   your wallet address.** Both are hard prize-eligibility requirements:
   no connected GitHub + wallet = no prize payout, however well the agent
   scores.
3. **Deploy the agent first** (section 2) and confirm
   `https://<your-host>/health` answers `{ "ok": true, ... }` from the
   public internet.
4. **Dashboard → My Agents → Register agent** — enter the FULL endpoint URL
   including the path, e.g. `https://<your-host>/agent`, and select the
   **Proof Gatekeeper** event.
5. **Copy the agent secret the platform shows (once)** and get it into the
   agent's environment as `AGENT_GAMES_HMAC_SECRET` via the secure flow —
   then restart the agent. (If you missed the one-time reveal: agent
   settings → **Rotate Secret** → copy the new plaintext → same step. The
   old secret dies the moment you rotate.)
6. **Run preflight** from the dashboard and confirm the agent is marked
   **active**. A signature error here means the secret in the environment
   doesn't match the platform's — re-check step 5 before anything else.
7. **Practice mode** — send practice tasks (cap: 10/hour) and confirm in the
   dashboard's debugging history that decisions land as expected, including
   at least one of each trap type if the generator offers them. This is also
   where the SPEC-NOTES open items (signature encoding, taskId encoding)
   get confirmed for free.
8. **Before the first scored round (tonight, 18:30 WITA)** — re-check the
   agent shows active, the host is up, and the endpoint answers health.
   Entries lock while a round is open; an agent that is down at delivery
   forfeits the task.
9. *(Steal the VFY, later)* — that track additionally needs a strategy
   commitment registered from **Dashboard → My Agents → Edit agent** before
   Swiss Round 1 pairing, or the platform cannot pair the agent at all.
