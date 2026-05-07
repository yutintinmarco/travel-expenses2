import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
const port = process.env.PORT || 8787;

// 如果你前端同後端同域，可唔使 cors；保留方便開發
app.use(cors());
app.use(express.json({ limit: "12mb" }));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 健康檢查
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "receipt-ai-api" });
});

function clampConfidence(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function normalizeCurrency(code, allowed = []) {
  const c = String(code || "").toUpperCase().trim();
  if (allowed.includes(c)) return c;
  // fallback
  if (["HKD", "JPY", "CNY", "TWD", "KRW", "USD"].includes(c)) return c;
  return allowed[0] || "HKD";
}

function normalizeDate(value) {
  // 只接受 YYYY-MM-DD
  const s = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return s;
}

function normalizeTotal(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function buildSystemPrompt() {
  return `
You extract receipt fields from OCR text + image.
Return STRICT JSON only, no markdown.

Required JSON schema:
{
  "merchant": string,
  "date": "YYYY-MM-DD" | "",
  "currency": string,
  "total": number | null,
  "confidence": number, 
  "reason": string
}

Rules:
1) "total" must be final payable amount, not subtotal/tax/change.
2) Prefer explicit keywords: TOTAL, GRAND TOTAL, AMOUNT DUE, 應付, 合計, 總計.
3) If uncertain, still return best guess and lower confidence.
4) Date must be YYYY-MM-DD when possible; else empty string.
5) currency must be one of expectedCurrencies if possible.
6) confidence in [0,1].
`.trim();
}

function buildUserPrompt({ ocrText, timezone, expectedCurrencies }) {
  return `
Timezone: ${timezone || "UTC"}
Expected currencies: ${(expectedCurrencies || []).join(", ")}

OCR text:
${ocrText || ""}

Please return strict JSON only.
`.trim();
}

app.post("/api/receipt/analyze", async (req, res) => {
  try {
    const {
      imageBase64,
      mimeType,
      ocrText,
      timezone,
      expectedCurrencies
    } = req.body || {};

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ error: "imageBase64 is required" });
    }

    const allowed = Array.isArray(expectedCurrencies) && expectedCurrencies.length
      ? expectedCurrencies.map(v => String(v).toUpperCase())
      : ["HKD", "JPY", "CNY", "TWD", "KRW", "USD"];

    // 用 Responses API（多模態）
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: buildSystemPrompt() }]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildUserPrompt({ ocrText, timezone, expectedCurrencies: allowed })
            },
            {
              type: "input_image",
              image_url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}`
            }
          ]
        }
      ],
      temperature: 0.1
    });

    const raw = response.output_text || "";
    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch {
      // 如果 model 有機會加咗雜字，嘗試抽 JSON 區段
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start >= 0 && end > start) {
        parsed = JSON.parse(raw.slice(start, end + 1));
      } else {
        throw new Error("Model did not return valid JSON");
      }
    }

    const merchant = String(parsed.merchant || "").trim() || "Receipt";
    const date = normalizeDate(parsed.date);
    const currency = normalizeCurrency(parsed.currency, allowed);
    const total = normalizeTotal(parsed.total);
    const confidence = clampConfidence(parsed.confidence);
    const reason = String(parsed.reason || "").trim().slice(0, 1000);

    const result = {
      merchant,
      date,
      currency,
      total,
      confidence,
      reason
    };

    return res.json(result);
  } catch (error) {
    console.error("analyze error:", error);
    return res.status(500).json({
      error: "analyze_failed",
      message: error?.message || "Unknown server error"
    });
  }
});

app.listen(port, () => {
  console.log(`✅ receipt-ai-api running on http://localhost:${port}`);
});