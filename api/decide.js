// Vercel Serverless Function：AI 腦的後台。尚未用真實金鑰測試（見 docs/PROTOTYPE_NOTES.md）。
// 需要環境變數 ANTHROPIC_API_KEY；可選 TOWN_MODEL（預設 claude-haiku-5-5）。
import { buildPrompt } from '../legacy/prompt.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: 'AI 腦尚未設定金鑰' });

  try {
    const { npc, snapshot, memory } = req.body ?? {};
    if (!npc || !snapshot) return res.status(400).json({ error: 'bad request' });
    const { system, user } = buildPrompt(npc, snapshot, Array.isArray(memory) ? memory : []);

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.TOWN_MODEL || 'claude-haiku-5-5',
        max_tokens: 200,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!r.ok) return res.status(502).json({ error: `upstream ${r.status}` });
    const data = await r.json();
    const text = data?.content?.[0]?.text ?? '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return res.status(502).json({ error: 'no json' });
    return res.status(200).json(JSON.parse(m[0])); // 前端會再 validate 一次
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
}
