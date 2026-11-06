/**
 * Ordered, append-only schema migrations (the research's production tables plus auth). The schema is unreleased, so
 * 001_init is the whole coherent set; later changes must be added as new versions, never edited in place.
 */
export const MIGRATIONS: { version: string; sql: string }[] = [
  {
    version: "001_init",
    sql: `
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address text UNIQUE,
  display_name text,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE siwe_nonces (
  nonce text PRIMARY KEY,
  created_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  csrf_token text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  ens_name text,
  repo_url text,
  domain text,
  chain_id integer,
  rpc_url text,
  resolver_address text,
  timelock_address text,
  signer_spki text,
  is_demo boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_repo_idx ON projects(lower(repo_url));

CREATE TABLE project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'maintainer', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE project_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role text NOT NULL,
  chain_id integer NOT NULL,
  address text NOT NULL,
  listed boolean NOT NULL,
  source text NOT NULL CHECK (source IN ('demo', 'manifest', 'user')),
  UNIQUE (project_id, chain_id, address, role)
);

CREATE TABLE api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX api_tokens_user_idx ON api_tokens(user_id);

CREATE TABLE uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  sha256 text NOT NULL,
  size_bytes bigint NOT NULL,
  entries integer NOT NULL,
  expanded_bytes bigint NOT NULL,
  file_name text NOT NULL,
  path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE analysis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('analyze', 'fix')),
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  source jsonb NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  commit_sha text,
  toolchain_hash text NOT NULL,
  request_hash text NOT NULL,
  idempotency_key text NOT NULL,
  result jsonb,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  cancel_requested boolean NOT NULL DEFAULT false,
  worker_id text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  heartbeat_at timestamptz,
  UNIQUE (project_id, idempotency_key)
);
CREATE INDEX analysis_jobs_queue_idx ON analysis_jobs(status, created_at);
CREATE INDEX analysis_jobs_project_idx ON analysis_jobs(project_id, created_at DESC);
CREATE INDEX analysis_jobs_request_idx ON analysis_jobs(project_id, request_hash);

CREATE TABLE job_events (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  step text NOT NULL,
  status text NOT NULL,
  message text NOT NULL,
  UNIQUE (job_id, seq)
);

CREATE TABLE findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
  label text NOT NULL,
  finding_key text NOT NULL,
  vuln_class text NOT NULL,
  title text NOT NULL,
  severity text NOT NULL,
  confidence text NOT NULL,
  status text NOT NULL CHECK (status IN ('reproduced', 'not-reproduced', 'candidate', 'inconclusive', 'fixed-verified')),
  contract text NOT NULL,
  function_sig text,
  file text,
  lines integer[],
  sources jsonb NOT NULL,
  template_id text,
  plan jsonb,
  plan_error text,
  contract_info jsonb,
  gates jsonb NOT NULL DEFAULT '[]'::jsonb,
  vulnerable_run jsonb,
  pairs jsonb NOT NULL DEFAULT '[]'::jsonb,
  engine_result jsonb NOT NULL,
  review_decision text CHECK (review_decision IN ('confirmed', 'false-positive')),
  review_note text,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, label)
);
CREATE INDEX findings_project_idx ON findings(project_id, created_at DESC);
CREATE INDEX findings_status_idx ON findings(project_id, status);
CREATE INDEX findings_key_idx ON findings(project_id, finding_key, created_at DESC);

CREATE TABLE exploit_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  contract_name text NOT NULL,
  source text NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exploit_tests_finding_idx ON exploit_tests(finding_id);

CREATE TABLE fix_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  generator text NOT NULL CHECK (generator IN ('deterministic', 'ai')),
  file text NOT NULL,
  diff text NOT NULL,
  after_source text,
  change text,
  explanation text NOT NULL,
  status text NOT NULL CHECK (status IN ('proposed', 'verifying', 'verified', 'failed', 'rejected')),
  verification jsonb,
  job_id uuid REFERENCES analysis_jobs(id) ON DELETE SET NULL,
  pr_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fix_proposals_finding_idx ON fix_proposals(finding_id);

-- body holds the exact canonical (RFC 8785) bytes whose sha256 is published; text, not jsonb, so it is never re-encoded.
CREATE TABLE evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  sha256 text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (finding_id, sha256)
);

CREATE TABLE releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag text NOT NULL,
  commit_sha text,
  manifest jsonb NOT NULL,
  manifest_bytes bytea NOT NULL,
  manifest_sha256 text NOT NULL,
  pointer text NOT NULL,
  cid text,
  signature jsonb,
  signature_status text NOT NULL CHECK (signature_status IN ('verified', 'invalid', 'unsigned')),
  signature_detail text,
  signer_key_id text,
  storage jsonb NOT NULL DEFAULT '{}'::jsonb,
  timelock_op_id text,
  queue_tx text,
  execute_tx text,
  eta timestamptz,
  status text NOT NULL CHECK (status IN ('draft', 'signed', 'queued', 'active', 'superseded', 'cancelled', 'revoked')),
  refreshed_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, tag),
  UNIQUE (project_id, manifest_sha256)
);
CREATE INDEX releases_project_idx ON releases(project_id, created_at DESC);
CREATE INDEX releases_sha_idx ON releases(manifest_sha256);

CREATE TABLE artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  path text NOT NULL,
  sha256 text NOT NULL,
  sri text NOT NULL,
  size_bytes bigint
);
CREATE INDEX artifacts_release_idx ON artifacts(release_id);

CREATE TABLE release_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  label text NOT NULL,
  chain_id integer NOT NULL,
  address text NOT NULL,
  runtime_codehash text NOT NULL,
  proxy_type text,
  impl_address text,
  impl_codehash text,
  sourcify_status text
);
CREATE INDEX release_contracts_release_idx ON release_contracts(release_id);

CREATE TABLE monitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('timelock', 'resolver', 'registry', 'proxy', 'upgrade-timelock')),
  chain_id integer NOT NULL,
  address text NOT NULL,
  rpc_url text NOT NULL,
  label text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'demo')),
  last_block bigint,
  last_checked_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind, chain_id, address)
);

-- One row per (monitor, log): a re-poll of the same block range can never create a second event or alert.
CREATE TABLE monitor_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id uuid NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chain_id integer NOT NULL,
  block_number bigint NOT NULL,
  block_time timestamptz,
  tx_hash text NOT NULL,
  log_index integer NOT NULL,
  address text NOT NULL,
  event_name text NOT NULL,
  data jsonb NOT NULL,
  assessment text NOT NULL CHECK (assessment IN ('critical', 'warning', 'info', 'ok')),
  detail text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (monitor_id, chain_id, tx_hash, log_index)
);
CREATE INDEX monitor_events_project_idx ON monitor_events(project_id, block_number DESC);

CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  monitor_event_id uuid REFERENCES monitor_events(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('monitor', 'cre')),
  severity text NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  eta timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acked')),
  acked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  acked_at timestamptz,
  idempotency_key text NOT NULL UNIQUE,
  delivery jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alerts_project_idx ON alerts(project_id, created_at DESC);

-- Replay protection for signed inbound calls (CRE idempotency keys, GitHub delivery ids).
CREATE TABLE ingest_receipts (
  source text NOT NULL,
  key text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (source, key)
);

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  action text NOT NULL,
  target text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_project_idx ON audit_log(project_id, at DESC);
`,
  },
];
