// 遊戲大廳訪客統計（Vercel Serverless Function）
// 每個瀏覽器只會被記一次：前端把隨機 id 存在 localStorage，後端用 Redis Set 去重。
// 需要在 Vercel 專案連接 Upstash Redis（Storage → Upstash Redis），環境變數會自動注入。
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|curl|wget/i;

async function redis(cmds){
  const r = await fetch(URL_ + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).map(function(x){ return x.result; });
}
function taipeiDay(offset){ return new Date(Date.now() + 8 * 3600e3 - (offset || 0) * 86400e3).toISOString().slice(0, 10); }

module.exports = async function(req, res){
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN){ res.status(200).json({ ok: false, reason: 'storage-not-configured' }); return; }
  try {
    var id = null;
    if (req.method === 'POST'){
      var body = req.body; if (typeof body === 'string'){ try { body = JSON.parse(body); } catch (e) { body = {}; } }
      var raw = body && body.id ? String(body.id) : '';
      if (/^[A-Za-z0-9-]{16,64}$/.test(raw) && !BOT.test(req.headers['user-agent'] || '')) id = raw;
    }
    var today = taipeiDay(0), isNew = false;
    if (id){
      var added = (await redis([['SADD', 'lobby:visitors', id]]))[0];
      if (added === 1){ isNew = true; await redis([['INCR', 'lobby:new:' + today]]); }
    }
    var days = []; for (var i = 6; i >= 0; i--) days.push(taipeiDay(i));
    var out = await redis([['SCARD', 'lobby:visitors'], ['MGET'].concat(days.map(function(d){ return 'lobby:new:' + d; }))]);
    var counts = (out[1] || []).map(function(v){ return +v || 0; });
    res.status(200).json({ ok: true, total: +out[0] || 0, today: counts[6] || 0, isNew: isNew, last7: days.map(function(d, k){ return { d: d, n: counts[k] }; }) });
  } catch (e) {
    res.status(200).json({ ok: false, reason: 'error' });
  }
};
