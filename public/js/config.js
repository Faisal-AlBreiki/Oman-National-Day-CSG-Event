/*
 * Public GitHub configuration.
 * Demo mode is enabled for local evaluation only.
 * Before a real deployment, add your own Supabase URL and publishable key,
 * then set DEMO_MODE to false. Never use a secret or service_role key here.
 */
window.APP_CONFIG = {
  DEMO_MODE: true,
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "YOUR_SUPABASE_PUBLISHABLE_KEY",
  POLL_INTERVAL_MS: 2500,
  DEMO_ADMIN_PIN: "1400"
};
