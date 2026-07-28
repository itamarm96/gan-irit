// Serverless proxy to Gemini. The API key lives only in Vercel's environment —
// never in this repo and never in the browser.
//
// Required Vercel environment variables:
//   GEMINI_API_KEY  – the Google AI Studio key
//   APP_PASSWORD    – a passphrase the app asks for once (keeps the public
//                     endpoint from being used by strangers who find the URL)
// Optional:
//   GEMINI_MODEL    – defaults to gemini-2.5-flash

const DEFAULT_MODEL = 'gemini-2.5-flash';

const SYSTEM_PROMPT = `את/ה עוזר/ת תכנון פדגוגי לגננת בגן דתי בישראל ("גן עירית").
ברשותך קטעים מתוך בנק הפעילויות האישי של הגננת — פעילויות שהיא עצמה כתבה בדפי הקשר שלה לאורך השנים.

כללי עבודה:
1. בסס/י את התשובה קודם כל על הפעילויות שנשלחו אליך בהקשר. כשאת/ה מציע/ה פעילות מתוכן — ציין/י בסוגריים את המקור (שם דף הקשר).
2. אם ההקשר לא מכיל משהו מתאים, אמור/י זאת בכנות והצע/י רעיון חדש ברוח הגן — וסמן/י בבירור שזה רעיון חדש ולא מהבנק.
3. שמור/י על השפה, הערכים והאופי הדתי של הגן, ועל ניסוח חם ומכבד.
4. תשובות מעשיות ומוכנות לשימוש: רשימות קצרות, שלבים ברורים, בלי הקדמות ארוכות.
5. מבנה יום הגן: מפגש בוקר ותפילה · קבוצות לפי תחום · פעילות בתנועה · ארוחה · מפגש תוכן · יצירה · מרכזי הגן · חצר · מפגש סיום.
6. ענה/י בעברית.`;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'חסר מפתח API. יש להגדיר GEMINI_API_KEY בהגדרות הפרויקט ב-Vercel.' });
  }

  const gate = process.env.APP_PASSWORD;
  if (gate) {
    const given = (req.headers['x-app-password'] || '').toString();
    if (given !== gate) return res.status(401).json({ error: 'סיסמת גישה שגויה.' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const question = (body && body.question || '').toString().slice(0, 4000);
  const context = Array.isArray(body && body.context) ? body.context.slice(0, 20) : [];
  const history = Array.isArray(body && body.history) ? body.history.slice(-8) : [];
  if (!question) return res.status(400).json({ error: 'חסרה שאלה.' });

  const contextText = context.length
    ? context.map((c, i) =>
        `--- פעילות ${i + 1} ---\nתחום: ${c.domain || ''}\nמיומנות: ${c.skill || ''}\nכותרת: ${c.title || ''}\nמקור: ${c.source || ''}\nתוכן: ${c.text || ''}`
      ).join('\n\n')
    : '(לא נמצאו פעילויות מתאימות בבנק לשאילתה הזו)';

  const contents = [];
  for (const h of history) {
    if (!h || !h.text) continue;
    contents.push({ role: h.role === 'model' ? 'model' : 'user', parts: [{ text: String(h.text).slice(0, 2000) }] });
  }
  contents.push({ role: 'user', parts: [{ text: `פעילויות רלוונטיות מהבנק שלי:\n\n${contextText}\n\n----\nהשאלה שלי: ${question}` }] });

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
      })
    });
    const data = await r.json();
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || `שגיאת Gemini (${r.status})`;
      return res.status(502).json({ error: msg });
    }
    const cand = data && data.candidates && data.candidates[0];
    const text = cand && cand.content && cand.content.parts
      ? cand.content.parts.map(p => p.text || '').join('').trim()
      : '';
    if (!text) return res.status(502).json({ error: 'לא התקבלה תשובה מהמודל.' });
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: 'שגיאת רשת בפנייה ל-Gemini.' });
  }
}
