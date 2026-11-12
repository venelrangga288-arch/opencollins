export default function DocsPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Documentation</h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Connect your application to DGT.LZ Gateway.
      </p>

      <section className="mt-8 space-y-4 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">Base URL</h2>
        <pre className="rounded-md bg-neutral-100 p-3 font-mono text-xs dark:bg-neutral-900">
          {process.env.NEXT_PUBLIC_API_BASE ?? "https://dgtlz.my.id/api/v1"}
        </pre>

        <h2 className="text-lg font-semibold">Authentication</h2>
        <p>Send your DGT.LZ key as a Bearer token:</p>
        <pre className="rounded-md bg-neutral-100 p-3 font-mono text-xs dark:bg-neutral-900">{`Authorization: Bearer dgtlz_live_...`}</pre>

        <h2 className="text-lg font-semibold">Chat completions</h2>
        <pre className="overflow-x-auto rounded-md bg-neutral-100 p-3 font-mono text-xs dark:bg-neutral-900">{`curl ${process.env.NEXT_PUBLIC_API_BASE ?? "https://dgtlz.my.id/api/v1"}/chat/completions \\
  -H "Authorization: Bearer dgtlz_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "MODEL_ID",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`}</pre>

        <h2 className="text-lg font-semibold">Streaming</h2>
        <p>Add <code className="font-mono text-xs">"stream": true</code> to receive Server-Sent Events.</p>

        <h2 className="text-lg font-semibold">Errors</h2>
        <p>All errors return a standardized envelope:</p>
        <pre className="rounded-md bg-neutral-100 p-3 font-mono text-xs dark:bg-neutral-900">{`{
  "error": {
    "code": "rate_limited",
    "message": "rate limit exceeded: 60 requests / 60s",
    "request_id": "req_..."
  }
}`}</pre>
      </section>
    </div>
  );
}
