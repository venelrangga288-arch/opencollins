const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "https://dgtlz.my.id/api/v1";

export default function DocsPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl font-bold tracking-tight text-haze-white">Docs</h1>
      <p className="mt-1 text-[13px] text-haze-haze">Connect your application to DGT.LZ Gateway.</p>

      <section className="mt-8 space-y-6 text-[13px] leading-relaxed text-haze-lite">
        <div>
          <div className="stat-label">Base URL</div>
          <pre className="card mt-2 p-3 font-mono text-xs text-glint">{BASE}</pre>
        </div>

        <div>
          <div className="stat-label">Authentication</div>
          <p className="mt-2">Send your DGT.LZ key as a Bearer token:</p>
          <pre className="card mt-2 p-3 font-mono text-xs text-haze-bright">{`Authorization: Bearer dgtlz_live_...`}</pre>
        </div>

        <div>
          <div className="stat-label">Chat completions</div>
          <pre className="card ide-scroll mt-2 overflow-x-auto p-3 font-mono text-xs leading-relaxed text-haze-bright">{`curl ${BASE}/chat/completions \\
  -H "Authorization: Bearer dgtlz_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "MODEL_ID",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`}</pre>
        </div>

        <div>
          <div className="stat-label">Streaming</div>
          <p className="mt-2">
            Add <span className="inline-code">&quot;stream&quot;: true</span> to receive Server-Sent Events with usage in the final chunk.
          </p>
        </div>

        <div>
          <div className="stat-label">Errors</div>
          <p className="mt-2">All errors return one standardized envelope:</p>
          <pre className="card mt-2 p-3 font-mono text-xs text-haze-bright">{`{
  "error": {
    "code": "rate_limited",
    "message": "rate limit exceeded: 60 requests / 60s",
    "request_id": "req_..."
  }
}`}</pre>
        </div>
      </section>
    </div>
  );
}
