export default function SettingsPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Account preferences and quotas.
      </p>
      <div className="mt-8 rounded-lg border border-neutral-200 p-6 text-sm dark:border-neutral-800">
        <p className="text-neutral-500 dark:text-neutral-400">
          Settings management (profile, password change, quota display) is wired to the gateway
          <code className="mx-1 font-mono text-xs">/api/v1/auth/me</code> endpoint. Admin configuration
          (quotas, rate limits, providers) lives in the protected admin interface.
        </p>
      </div>
    </div>
  );
}
