// Gọi Gemini API (REST, streaming) bằng fetch có sẵn của Node 18+. Không cần thư viện ngoài.

export async function* streamGemini({
  apiKey,
  model,
  system,
  messages,
  signal,
  baseUrl = "https://generativelanguage.googleapis.com",
}) {
  const url = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: 4096 },
    }),
  });

  if (!res.ok) {
    let msg = `Gemini báo lỗi ${res.status}`;
    try {
      const j = await res.json();
      if (j?.error?.message) msg = j.error.message;
    } catch {}
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  function* parseEvent(block) {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    let json;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    if (json?.promptFeedback?.blockReason) {
      throw new Error("Gemini từ chối nội dung này (" + json.promptFeedback.blockReason + ").");
    }
    const parts = json?.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      if (typeof p.text === "string" && !p.thought) yield p.text;
    }
  }

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    const blocks = buf.split("\n\n");
    buf = blocks.pop();
    for (const b of blocks) yield* parseEvent(b);
  }
  buf += decoder.decode().replace(/\r\n/g, "\n");
  if (buf.trim()) yield* parseEvent(buf);
}
