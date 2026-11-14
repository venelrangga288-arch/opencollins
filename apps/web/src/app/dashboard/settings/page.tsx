export default function SettingsPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl font-bold tracking-tight text-haze-white">Settings</h1>
      <p className="mt-1 text-[13px] text-haze-haze">Account preferences and quotas.</p>
      <div className="card mt-8 p-6 text-[13px] leading-relaxed text-haze-lite">
        <p>
          Settings management (profile, password change, quota display) is wired to the gateway{" "}
          <span className="inline-code">/api/v1/auth/me</span> endpoint. Admin configuration (quotas,
          rate limits, providers) lives in the protected operator console.
        </p>
      </div>
    </div>
  );
}
