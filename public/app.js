const MODES = {
  chat: {
    icon: "💬",
    name: "Trò chuyện",
    desc: "Hỏi đáp mọi chủ đề cùng AI",
    placeholder: "Hỏi CAUTRAL bất cứ điều gì...",
    suggestions: ["Giải thích blockchain cho người mới", "Gợi ý lịch trình 3 ngày ở Đà Lạt", "So sánh Python và JavaScript"],
  },
  write: {
    icon: "✍️",
    name: "Sáng tạo nội dung",
    desc: "Bài viết, caption, email, kịch bản, ý tưởng",
    placeholder: "Bạn muốn viết gì? (chủ đề, giọng văn, độ dài...)",
    suggestions: ["Viết caption Instagram cho quán cà phê mới mở", "Soạn email xin nghỉ phép lịch sự", "Gợi ý 10 tiêu đề blog về tiết kiệm tiền"],
  },
  study: {
    icon: "🎓",
    name: "Trợ lý học tập",
    desc: "Giải thích, tóm tắt, tạo flashcard và câu hỏi ôn tập",
    placeholder: "Bạn đang học gì? Dán bài hoặc đặt câu hỏi...",
    suggestions: ["Giải thích đạo hàm bằng ví dụ đời thường", "Tạo 10 flashcard về Chiến tranh thế giới thứ hai", "Lộ trình ôn thi IELTS trong 8 tuần"],
  },
  data: {
    icon: "📊",
    name: "Phân tích dữ liệu",
    desc: "Đính kèm CSV/JSON/TXT để AI phân tích",
    placeholder: "Đính kèm file (📎) rồi hỏi, ví dụ: tóm tắt xu hướng chính",
    suggestions: ["Tóm tắt cấu trúc và số liệu chính của dữ liệu", "Tìm điểm bất thường trong dữ liệu", "Đề xuất cách trực quan hoá dữ liệu này"],
  },
};

const MAX_FILE_CHARS = 60000;
const STORE_KEY = "cautral.v1";

const $ = (id) => document.getElementById(id);
const el = {
  modes: $("modes"), chat: $("chat"), form: $("form"), input: $("input"), send: $("sendBtn"),
  title: $("modeTitle"), desc: $("modeDesc"), clear: $("clearBtn"), sidebar: $("sidebar"), menu: $("menuBtn"),
  attachBtn: $("attachBtn"), file: $("file"), attachment: $("attachment"),
};

let state = load();
let attached = null; // { name, text, truncated }
let busy = false;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.mode && MODES[s.mode]) return s;
  } catch {}
  return { mode: "chat", history: { chat: [], write: [], study: [], data: [] } };
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
}

function renderMarkdown(text) {
  const html = window.marked ? marked.parse(text, { breaks: true }) : text.replace(/</g, "&lt;");
  return window.DOMPurify ? DOMPurify.sanitize(html) : html;
}

function renderModes() {
  el.modes.innerHTML = "";
  for (const [key, m] of Object.entries(MODES)) {
    const b = document.createElement("button");
    b.className = "mode" + (key === state.mode ? " active" : "");
    b.innerHTML = `<span class="ico">${m.icon}</span><span>${m.name}</span>`;
    b.onclick = () => { state.mode = key; save(); clearAttachment(); render(); el.sidebar.classList.remove("open"); };
    el.modes.appendChild(b);
  }
}

function addMessage(role, content, opts = {}) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + role;
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "Bạn" : "C";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (role === "user") {
    bubble.textContent = opts.display ?? content;
    if (opts.fileName) {
      const note = document.createElement("span");
      note.className = "file-note";
      note.textContent = "📎 " + opts.fileName;
      bubble.appendChild(note);
    }
  } else {
    bubble.innerHTML = renderMarkdown(content);
  }
  wrap.append(avatar, bubble);
  el.chat.appendChild(wrap);
  el.chat.scrollTop = el.chat.scrollHeight;
  return bubble;
}

function render() {
  const m = MODES[state.mode];
  el.title.textContent = `${m.icon} ${m.name}`;
  el.desc.textContent = m.desc;
  el.input.placeholder = m.placeholder;
  renderModes();
  el.chat.innerHTML = "";
  const hist = state.history[state.mode];
  if (hist.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML = `<h2>Xin chào, mình là CAUTRAL</h2><p>${m.desc}.</p>`;
    const box = document.createElement("div");
    box.className = "suggestions";
    m.suggestions.forEach((s) => {
      const c = document.createElement("button");
      c.className = "chip";
      c.textContent = s;
      c.onclick = () => { el.input.value = s; el.input.focus(); autosize(); };
      box.appendChild(c);
    });
    empty.appendChild(box);
    el.chat.appendChild(empty);
  } else {
    hist.forEach((h) => addMessage(h.role, h.content, { display: h.display, fileName: h.fileName }));
  }
}

function autosize() {
  el.input.style.height = "auto";
  el.input.style.height = Math.min(el.input.scrollHeight, 180) + "px";
}

function clearAttachment() {
  attached = null;
  el.attachment.hidden = true;
  el.attachment.innerHTML = "";
  el.file.value = "";
}

function showAttachment() {
  el.attachment.hidden = false;
  el.attachment.innerHTML = "";
  const t = document.createElement("span");
  t.textContent = `📎 ${attached.name}` + (attached.truncated ? " (đã cắt bớt vì quá dài)" : "");
  const x = document.createElement("button");
  x.type = "button";
  x.textContent = "✕";
  x.onclick = clearAttachment;
  el.attachment.append(t, x);
}

el.attachBtn.onclick = () => el.file.click();
el.file.onchange = async () => {
  const f = el.file.files[0];
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) { alert("File quá lớn (tối đa 5MB)."); el.file.value = ""; return; }
  let text = await f.text();
  const truncated = text.length > MAX_FILE_CHARS;
  if (truncated) text = text.slice(0, MAX_FILE_CHARS);
  attached = { name: f.name, text, truncated };
  showAttachment();
};

el.clear.onclick = () => {
  if (busy) return;
  if (!state.history[state.mode].length || confirm("Xoá cuộc trò chuyện ở chế độ này?")) {
    state.history[state.mode] = [];
    save();
    render();
  }
};
el.menu.onclick = () => el.sidebar.classList.toggle("open");

el.input.addEventListener("input", autosize);
el.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    el.form.requestSubmit();
  }
});

el.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  const typed = el.input.value.trim();
  if (!typed && !attached) return;

  const mode = state.mode;
  const question = typed || "Hãy phân tích dữ liệu đính kèm.";
  let content = question;
  if (attached) {
    content =
      `${question}\n\n[Dữ liệu đính kèm: ${attached.name}${attached.truncated ? " — đã cắt bớt, chỉ gồm phần đầu file" : ""}]\n` +
      "```\n" + attached.text + "\n```";
  }
  const entry = { role: "user", content, display: question, fileName: attached?.name };

  const hist = state.history[mode];
  if (hist.length === 0) el.chat.innerHTML = "";
  hist.push(entry);
  addMessage("user", content, { display: question, fileName: entry.fileName });
  save();

  el.input.value = "";
  autosize();
  clearAttachment();
  await ask(mode);
});

async function ask(mode) {
  busy = true;
  el.send.disabled = true;
  const bubble = addMessage("assistant", "");
  bubble.classList.add("typing");
  let full = "";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        messages: state.history[mode].map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok || !res.body) {
      let msg = `Lỗi ${res.status}`;
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop();
      for (const part of parts) {
        if (!part.startsWith("data: ")) continue;
        const evt = JSON.parse(part.slice(6));
        if (evt.error) throw new Error(evt.error);
        if (evt.text) {
          full += evt.text;
          bubble.innerHTML = renderMarkdown(full);
          el.chat.scrollTop = el.chat.scrollHeight;
        }
      }
    }
    if (full) {
      state.history[mode].push({ role: "assistant", content: full });
      save();
    }
  } catch (err) {
    bubble.classList.add("error");
    bubble.textContent = "⚠️ " + err.message;
    if (full) {
      // keep the partial answer so the conversation stays consistent
      state.history[mode].push({ role: "assistant", content: full });
      save();
    } else {
      // drop the unanswered user turn so the next request starts clean
      state.history[mode].pop();
      save();
    }
  } finally {
    bubble.classList.remove("typing");
    busy = false;
    el.send.disabled = false;
    el.input.focus();
  }
}

render();
