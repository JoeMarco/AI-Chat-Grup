const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const express = require("express");

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data", "db.json");

ensureDataStore();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const AI_CONFIG = {
    Gemini: {
        key: () => process.env.GEMINI_API_KEY,
        model: () => process.env.GEMINI_MODEL || "gemini-3.6-flash"
    },
    Groq: {
        key: () => process.env.GROQ_API_KEY,
        model: () => process.env.GROQ_MODEL || "openai/gpt-oss-120b"
    },
    Ollama: {
        key: () => "local",
        model: () => process.env.OLLAMA_MODEL || "llama3.2"
    }
};

function ensureDataStore() {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(DATA_FILE)) {
        const defaultData = {
            groups: {
                "ai-syndicate": {
                    id: "ai-syndicate",
                    name: "AI Syndicate",
                    emoji: "🤖",
                    messages: [
                        { sender: "Gemini", content: "Halo Marco. Tekan @Gemini, @Groq, atau @Ollama untuk memanggil AI tertentu." },
                        { sender: "Groq", content: "Gunakan @all kalau kamu ingin semua AI ikut menjawab dalam satu percakapan." },
                        { sender: "Ollama", content: "Ollama berjalan lokal di komputer ini dan siap dipakai tanpa koneksi internet." }
                    ],
                    members: ["Gemini", "Groq", "Ollama"]
                },
                programming: {
                    id: "programming",
                    name: "Programming Team",
                    emoji: "💻",
                    messages: [{ sender: "System", content: "Programming Team siap digunakan." }],
                    members: ["Gemini", "Groq", "Ollama"]
                },
                study: {
                    id: "study",
                    name: "Study Group",
                    emoji: "📚",
                    messages: [{ sender: "System", content: "Study Group siap digunakan." }],
                    members: ["Gemini", "Ollama"]
                }
            },
            files: [],
            searchHistory: []
        };

        fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
    }

    try {
        const raw = fs.readFileSync(DATA_FILE, "utf8");
        return raw ? JSON.parse(raw) : { groups: {}, files: [], searchHistory: [] };
    } catch {
        return { groups: {}, files: [], searchHistory: [] };
    }
}

function writeDataStore(data) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    return data;
}

app.get("/api/store", (req, res) => {
    try {
        res.json({ success: true, data: ensureDataStore() });
    } catch (error) {
        console.error("[STORE READ ERROR]", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post("/api/store", (req, res) => {
    try {
        const payload = req.body || {};
        const current = ensureDataStore();
        const next = {
            ...current,
            ...payload,
            groups: { ...(current.groups || {}), ...(payload.groups || {}) },
            files: Array.isArray(payload.files) ? payload.files : current.files || [],
            searchHistory: Array.isArray(payload.searchHistory) ? payload.searchHistory : current.searchHistory || []
        };
        res.json({ success: true, data: writeDataStore(next) });
    } catch (error) {
        console.error("[STORE WRITE ERROR]", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post("/api/ai", async (req, res) => {
    const { ai, message, context = [], group = "AI Syndicate" } = req.body || {};

    try {
        if (!AI_CONFIG[ai]) {
            return res.status(400).json({
                success: false,
                error: `AI '${ai}' tidak tersedia.`
            });
        }

        if (!message?.trim()) {
            return res.status(400).json({
                success: false,
                error: "Message kosong."
            });
        }

        const systemPrompt = buildSystemPrompt(ai, group, context);
        let response;

        if (ai === "Gemini") {
            response = await callGemini(systemPrompt, message);
        } else if (ai === "Groq") {
            response = await callOpenAICompatible(
                "https://api.groq.com/openai/v1/chat/completions",
                process.env.GROQ_API_KEY,
                AI_CONFIG.Groq.model(),
                systemPrompt,
                message,
                "Groq"
            );
        } else if (ai === "Ollama") {
            response = await callOllama(systemPrompt, message);
        }

        const file = maybeGenerateFileAttachment(ai, message, response);
        res.json({ success: true, ai, response, file });
    } catch (error) {
        const requestedFile = detectRequestedFile(String(message || ""));
        if (requestedFile) {
            const fallbackText = `Saya sudah menyiapkan file ${requestedFile.ext.toUpperCase()} untuk permintaan Anda.\n\nTopik: ${String(message || "").trim()}\n\nCatatan: File ini dibuat secara lokal untuk demo chat AI agar Anda bisa mengunduh hasilnya langsung dari chat.`;
            const file = maybeGenerateFileAttachment(ai, message, fallbackText);
            return res.json({ success: true, ai, response: fallbackText, file });
        }

        console.error(`[AI ERROR]`, error);
        res.status(500).json({ success: false, error: formatProviderError(error.message) });
    }
});

function buildSystemPrompt(ai, group, context) {
    const history = Array.isArray(context) ? context.slice(-30) : [];

    return `You are ${ai}, an AI member inside the group "${group}".

Rules:
- Answer the user's actual request.
- You can read the previous messages below.
- Other AI answers may appear in the history. You may critique, correct, or build on them.
- Do not claim another AI's answer as your own.
- If another AI made a mistake, explicitly point it out and provide the corrected reasoning.
- Be useful and reasonably concise.

RECENT GROUP HISTORY:
${history.map(m => {
        const reply = m.replyTo ? `\n  In reply to [${m.replyTo.sender}]: ${m.replyTo.content}` : "";
        const attachment = m.attachment ? `\n  Attachment: ${m.attachment.name} (${m.attachment.type || "file"})` : "";
        return `[${m.sender}]: ${m.content}${reply}${attachment}`;
    }).join("\n")}`;
}

function formatProviderError(message) {
    if (/API_KEY belum diisi/i.test(message)) return `${message}. Isi konfigurasi provider di file .env.`;
    if (/fetch failed|ECONNREFUSED/i.test(message)) return "Provider lokal tidak aktif. Pastikan Ollama sedang berjalan.";
    if (/401|403/.test(message)) return "API key provider ditolak atau belum memiliki akses ke model ini.";
    if (/404/.test(message)) return "Model provider tidak ditemukan. Periksa nama model di file .env.";
    return message;
}

function maybeGenerateFileAttachment(ai, message, responseText) {
    const input = String(message || "").toLowerCase();
    const fileSpec = detectRequestedFile(input);
    if (!fileSpec) return null;

    const content = String(responseText || "").trim() || "File generated by AI.";
    const fileName = `${slugify(ai || "ai")}-${Date.now()}.${fileSpec.ext}`;
    const payload = serializeFileContent(fileSpec.ext, content);
    const buffer = Buffer.from(payload, "utf8");

    return {
        name: fileName,
        size: buffer.length,
        type: fileSpec.mimeType,
        dataUrl: `data:${fileSpec.mimeType};base64,${buffer.toString("base64")}`,
        generated: true
    };
}

function detectRequestedFile(input) {
    const lower = input.toLowerCase();
    const lookup = [
        { keywords: ["pdf", "document pdf"], ext: "pdf", mimeType: "application/pdf" },
        { keywords: ["word", "docx", "document", "dokumen"], ext: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
        { keywords: ["html", "web page"], ext: "html", mimeType: "text/html; charset=utf-8" },
        { keywords: ["json", "javascript object notation"], ext: "json", mimeType: "application/json" },
        { keywords: ["csv"], ext: "csv", mimeType: "text/csv; charset=utf-8" },
        { keywords: ["txt", "text file", "teks"], ext: "txt", mimeType: "text/plain; charset=utf-8" },
        { keywords: ["md", "markdown"], ext: "md", mimeType: "text/markdown; charset=utf-8" }
    ];

    const match = lookup.find(entry =>
        entry.keywords.some(keyword => lower.includes(keyword))
    );

    if (!match) {
        const wantsFile = /(bikin|buat|generate|create|ciptakan|membuat).*(file|dokumen|document|pdf|word|html|json|csv|txt|md)/i.test(lower);
        if (!wantsFile) return null;
        return { ext: "txt", mimeType: "text/plain; charset=utf-8" };
    }

    return match;
}

function serializeFileContent(ext, content) {
    const cleaned = String(content || "").replace(/\r\n/g, "\n");

    switch (ext) {
        case "pdf":
            return buildPdfContent(cleaned);
        case "html":
            return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>AI Generated Document</title></head><body><pre>${escapeHtml(cleaned)}</pre></body></html>`;
        case "json":
            return JSON.stringify({ content: cleaned, generatedBy: "AI Syndicate" }, null, 2);
        case "csv":
            return `content\n${cleaned.replace(/\n/g, "\n")}`;
        case "docx":
            return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${escapeXml(cleaned)}</w:t></w:r></w:p></w:body></w:document>`;
        default:
            return cleaned;
    }
}

function buildPdfContent(text) {
    const lines = String(text || "").split(/\n/).slice(0, 20);
    const escaped = lines
        .map(line => line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"))
        .join("\n");

    const content = `BT /F1 12 Tf 50 750 Td (${escaped}) Tj ET`;
    const stream = `BT\n/F1 12 Tf\n50 750 Td\n(${escaped}) Tj\nET`;
    const length = stream.length;

    return `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n4 0 obj\n<< /Length ${length} >>\nstream\n${stream}\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000010 00000 n \n0000000062 00000 n \n0000000127 00000 n \n0000000681 00000 n \n0000001160 00000 n \ntrailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n1220\n%%EOF`;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function escapeXml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function slugify(value) {
    return String(value || "file")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "file";
}

async function callGemini(systemPrompt, message) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY belum diisi di .env");

    const model = AI_CONFIG.Gemini.model();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            system_instruction: {
                parts: [{ text: systemPrompt }]
            },
            contents: [{
                role: "user",
                parts: [{ text: message }]
            }]
        })
    });

    const data = await readJSON(response);
    if (!response.ok) {
        throw new Error(`Gemini ${response.status}: ${extractAPIError(data)}`);
    }

    const text = data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("");

    if (!text) throw new Error("Gemini tidak mengembalikan teks.");
    return text;
}

async function callOpenAICompatible(url, key, model, systemPrompt, message, provider) {
    if (!key) throw new Error(`${provider.toUpperCase()}_API_KEY belum diisi di .env`);

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${key}`
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: message }
            ],
            temperature: 0.7
        })
    });

    const data = await readJSON(response);
    if (!response.ok) {
        throw new Error(`${provider} ${response.status}: ${extractAPIError(data)}`);
    }

    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error(`${provider} tidak mengembalikan teks.`);
    return text;
}

async function callOllama(systemPrompt, message) {
    const baseURL = process.env.OLLAMA_URL || "http://localhost:11434";
    const model = AI_CONFIG.Ollama.model();

    const response = await fetch(`${baseURL.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model,
            stream: false,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: message }
            ]
        })
    });

    const data = await readJSON(response);
    if (!response.ok) {
        throw new Error(`Ollama ${response.status}: ${extractAPIError(data)}`);
    }

    const text = data?.message?.content;
    if (!text) throw new Error("Ollama tidak mengembalikan teks. Pastikan Ollama aktif dan model sudah di-pull.");
    return text;
}

app.get("/api/youtube/search", async (req, res) => {
    try {
        const q = String(req.query.q || "").trim();
        const key = process.env.YOUTUBE_API_KEY;

        if (!q) {
            return res.status(400).json({ success: false, error: "Query YouTube kosong." });
        }

        if (!key) {
            return res.status(503).json({
                success: false,
                error: "Pencarian YouTube membutuhkan YOUTUBE_API_KEY di file .env."
            });
        }

        const url = new URL("https://www.googleapis.com/youtube/v3/search");
        url.searchParams.set("part", "snippet");
        url.searchParams.set("q", q);
        url.searchParams.set("type", "video");
        url.searchParams.set("maxResults", "12");
        url.searchParams.set("order", "relevance");
        url.searchParams.set("key", key);

        const response = await fetch(url);
        const data = await readJSON(response);

        if (!response.ok) {
            throw new Error(`YouTube ${response.status}: ${extractAPIError(data)}`);
        }

        const items = (data.items || []).map(item => ({
            id: item.id.videoId,
            title: item.snippet.title,
            channel: item.snippet.channelTitle,
            thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
            publishedAt: item.snippet.publishedAt
        }));

        res.json({ success: true, items });
    } catch (error) {
        console.error(`[YOUTUBE ERROR]`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get("/api/youtube/home", async (req, res) => {
    try {
        const key = process.env.YOUTUBE_API_KEY;

        if (!key) {
            return res.json({ success: true, demo: true, items: demoYoutubeItems() });
        }

        const url = new URL("https://www.googleapis.com/youtube/v3/videos");
        url.searchParams.set("part", "snippet,contentDetails,statistics");
        url.searchParams.set("chart", "mostPopular");
        url.searchParams.set("regionCode", process.env.YOUTUBE_REGION || "ID");
        url.searchParams.set("maxResults", "18");
        url.searchParams.set("key", key);

        const response = await fetch(url);
        const data = await readJSON(response);
        if (!response.ok) throw new Error(`YouTube ${response.status}: ${extractAPIError(data)}`);

        const items = (data.items || []).map(item => ({
            id: item.id,
            title: item.snippet.title,
            channel: item.snippet.channelTitle,
            thumbnail: item.snippet.thumbnails?.maxres?.url || item.snippet.thumbnails?.high?.url,
            publishedAt: item.snippet.publishedAt,
            views: item.statistics?.viewCount || ""
        }));

        res.json({ success: true, items });
    } catch (error) {
        console.error(`[YOUTUBE HOME ERROR]`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

function demoYoutubeItems() {
    return [
        { id: "M7lc1UVf-VE", title: "Build interfaces that feel intentional", channel: "The Design Journal", thumbnail: "https://i.ytimg.com/vi/M7lc1UVf-VE/hq720.jpg", publishedAt: "2026-09-12T10:00:00Z", views: "184K" },
        { id: "ScMzIvxBSi4", title: "A calm, focused morning workflow", channel: "Field Notes", thumbnail: "https://i.ytimg.com/vi/ScMzIvxBSi4/hq720.jpg", publishedAt: "2026-09-10T10:00:00Z", views: "92K" },
        { id: "ysz5S6PUM-U", title: "The new shape of creative coding", channel: "Signal / Noise", thumbnail: "https://i.ytimg.com/vi/ysz5S6PUM-U/hq720.jpg", publishedAt: "2026-09-07T10:00:00Z", views: "311K" },
        { id: "aqz-KE-bpKQ", title: "Ideas worth making time for", channel: "Open Studio", thumbnail: "https://i.ytimg.com/vi/aqz-KE-bpKQ/hq720.jpg", publishedAt: "2026-09-02T10:00:00Z", views: "76K" },
        { id: "dQw4w9WgXcQ", title: "The sound of a perfect late-night drive", channel: "Night Shift Radio", thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hq720.jpg", publishedAt: "2026-08-30T10:00:00Z", views: "1.2M" },
        { id: "kJQP7kiw5Fk", title: "Why great products feel simple", channel: "Product People", thumbnail: "https://i.ytimg.com/vi/kJQP7kiw5Fk/hq720.jpg", publishedAt: "2026-08-27T10:00:00Z", views: "428K" },
        { id: "9bZkp7q19f0", title: "A visual history of the internet", channel: "Archive Room", thumbnail: "https://i.ytimg.com/vi/9bZkp7q19f0/hq720.jpg", publishedAt: "2026-08-23T10:00:00Z", views: "2.4M" },
        { id: "JGwWNGJdvx8", title: "The creative routine that actually works", channel: "Make / Repeat", thumbnail: "https://i.ytimg.com/vi/JGwWNGJdvx8/hq720.jpg", publishedAt: "2026-08-20T10:00:00Z", views: "684K" },
        { id: "L_jWHffIx5E", title: "How to think in systems", channel: "The Long View", thumbnail: "https://i.ytimg.com/vi/L_jWHffIx5E/hq720.jpg", publishedAt: "2026-08-16T10:00:00Z", views: "219K" },
        { id: "fJ9rUzIMcZQ", title: "One hour of focus music for deep work", channel: "Stillness FM", thumbnail: "https://i.ytimg.com/vi/fJ9rUzIMcZQ/hq720.jpg", publishedAt: "2026-08-12T10:00:00Z", views: "903K" },
        { id: "tgbNymZ7vqY", title: "The art of making a useful tool", channel: "Workshop 04", thumbnail: "https://i.ytimg.com/vi/tgbNymZ7vqY/hq720.jpg", publishedAt: "2026-08-09T10:00:00Z", views: "147K" },
        { id: "e-ORhEE9VVg", title: "Stories from the edge of technology", channel: "Future Tense", thumbnail: "https://i.ytimg.com/vi/e-ORhEE9VVg/hq720.jpg", publishedAt: "2026-08-05T10:00:00Z", views: "532K" },
        { id: "RgKAFK5djSk", title: "A field guide to better conversations", channel: "Human / Nature", thumbnail: "https://i.ytimg.com/vi/RgKAFK5djSk/hq720.jpg", publishedAt: "2026-08-01T10:00:00Z", views: "88K" },
        { id: "OPf0YbXqDm0", title: "What makes a song stay with you", channel: "Room Tone", thumbnail: "https://i.ytimg.com/vi/OPf0YbXqDm0/hq720.jpg", publishedAt: "2026-07-28T10:00:00Z", views: "764K" },
        { id: "CevxZvSJLk8", title: "Designing a quieter digital life", channel: "Offline Club", thumbnail: "https://i.ytimg.com/vi/CevxZvSJLk8/hq720.jpg", publishedAt: "2026-07-23T10:00:00Z", views: "126K" }
    ];
}

app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function readJSON(response) {
    const text = await response.text();
    try {
        return text ? JSON.parse(text) : {};
    } catch {
        return { raw: text };
    }
}

function extractAPIError(data) {
    return data?.error?.message || data?.message || data?.raw || "Unknown API error";
}

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`AI Syndicate running at http://localhost:${PORT}`);
    });
}

module.exports = { app, maybeGenerateFileAttachment };
