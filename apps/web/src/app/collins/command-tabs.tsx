"use client";

import { useState } from "react";

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "https://dgtlz.my.id/api/v1";

const TABS: Array<{ id: string; label: string; code: string }> = [
  {
    id: "curl",
    label: "curl",
    code: `curl ${BASE}/chat/completions \\
  -H "Authorization: Bearer dgtlz_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"glm-5.3-flash","messages":[{"role":"user","content":"hi"}]}'`,
  },
  {
    id: "opencode",
    label: "opencode",
    code: `// .opencode.json in your repo (or global config)
{
  "provider": {
    "dgtlz": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "DGT.LZ",
      "options": { "baseURL": "${BASE}" },
      "models": {
        "glm-5.3-flash": { "name": "GLM 5.3 Flash" }
      }
    }
  }
}`,
  },
  {
    id: "python",
    label: "python",
    code: `from openai import OpenAI

client = OpenAI(
    base_url="${BASE}",
    api_key="dgtlz_live_YOUR_KEY",
)

r = client.chat.completions.create(
    model="glm-5.3-flash",
    messages=[{"role": "user", "content": "Refactor this function..."}],
)
print(r.choices[0].message.content)`,
  },
  {
    id: "js",
    label: "node.js",
    code: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE}",
  apiKey: process.env.DGTLZ_API_KEY,
});

const r = await client.chat.completions.create({
  model: "glm-5.3-flash",
  messages: [{ role: "user", content: "Write tests for auth.ts" }],
});`,
  },
];

export default function CommandTabs() {
  const [tab, setTab] = useState("curl");
  const [copied, setCopied] = useState(false);
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="mt-8 overflow-hidden rounded-2xl border border-[#041024]/15 bg-[#111110] shadow-xl">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <div className="flex gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-3 py-1.5 font-mono text-xs transition-colors ${
                tab === t.id
                  ? "bg-[#262624] text-[#f4f4f2]"
                  : "text-[#8a8a86] hover:bg-[#1c1c1a] hover:text-[#d4d4d0]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => {
            navigator.clipboard.writeText(active.code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="rounded-md bg-white px-3 py-1.5 text-[11.5px] font-semibold text-[#0f0f0e] transition-colors hover:bg-[#e8e8e4]"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[12.5px] leading-relaxed text-[#e6e6e3]">
        {active.code}
      </pre>
    </div>
  );
}
