import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { streamGemini } from "./gemini.js";

// Đọc file .env khi chạy trên máy (trên Render thì biến môi trường đã có sẵn)
try {
  process.loadEnvFile?.();
} catch {}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

const BASE =
  "Bạn là CAUTRAL, một trợ lý AI thân thiện. Mặc định trả lời bằng tiếng Việt, " +
  "trừ khi người dùng viết bằng ngôn ngữ khác. Trả lời rõ ràng, chính xác, dùng Markdown khi hữu ích.";

const MODES = {
  chat: {
    name: "Trò chuyện",
    system: BASE + " Hãy trò chuyện tự nhiên, ngắn gọn, đi thẳng vào câu trả lời.",
  },
  write: {
    name: "Sáng tạo nội dung",
    system:
      BASE +
      " Bạn là cộng sự viết lách chuyên nghiệp: bài blog, caption mạng xã hội, email, kịch bản, quảng cáo, thơ, ý tưởng. " +
      "Nếu thiếu thông tin quan trọng (đối tượng, giọng văn, độ dài) hãy hỏi tối đa một câu rồi viết luôn bản nháp. " +
      "Đưa ra nội dung hoàn chỉnh, sẵn sàng dùng.",
  },
  study: {
    name: "Trợ lý học tập",
    system:
      BASE +
      " Bạn là gia sư kiên nhẫn. Giải thích từng bước, dùng ví dụ và phép so sánh dễ hiểu, " +
      "kiểm tra mức hiểu bằng một câu hỏi nhỏ ở cuối khi phù hợp. Có thể tóm tắt bài, tạo flashcard, " +
      "câu hỏi trắc nghiệm và lộ trình ôn tập. Với bài tập, hướng dẫn cách làm trước, đưa đáp án sau.",
  },
  data: {
    name: "Phân tích dữ liệu",
    system:
      BASE +
      " Bạn là chuyên gia phân tích dữ liệu. Người dùng có thể đính kèm dữ liệu (CSV, JSON, văn bản) trong tin nhắn. " +
      "Hãy mô tả cấu trúc dữ liệu, nêu số liệu chính, xu hướng, điểm bất thường và đề xuất bước tiếp theo. " +
      "Chỉ dùng số liệu có trong dữ liệu; nếu dữ liệu bị cắt bớt hoặc không đủ để kết luận, hãy nói rõ. " +
      "Trình bày bằng bảng Markdown khi so sánh số liệu.",
  },
};

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: MODEL, configured: Boolean(API_KEY) });
});

app.post("/api/chat", async (req, res) => {
  const { mode = "chat", messages } = req.body ?? {};

  if (!API_KEY) {
    return res.status(500).json({ error: "Chưa cấu hình GEMINI_API_KEY trên máy chủ." });
  }
  if (!MODES[mode]) {
    return res.status(400).json({ error: "Chế độ không hợp lệ" });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Thiếu tin nhắn" });
  }

  const clean = messages
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim()
    )
    .slice(-30)
    .map((m) => ({ role: m.role, content: m.content }));

  if (clean.length === 0 || clean[0].role !== "user") {
    return res.status(400).json({ error: "Tin nhắn không hợp lệ" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const ac = new AbortController();
  // Người dùng đóng trang giữa chừng thì dừng gọi AI
  res.on("close", () => {
    if (!res.writableFinished) ac.abort();
  });

  try {
    for await (const text of streamGemini({
      apiKey: API_KEY,
      model: MODEL,
      system: MODES[mode].system,
      messages: clean,
      signal: ac.signal,
    })) {
      send({ text });
    }
    send({ done: true });
  } catch (err) {
    if (!ac.signal.aborted && !res.writableEnded) {
      send({ error: err?.message || "Lỗi khi gọi AI" });
    }
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`CAUTRAL đang chạy tại http://localhost:${PORT} (model: ${MODEL})`);
  if (!API_KEY) console.warn("⚠️  Chưa có GEMINI_API_KEY.");
});
