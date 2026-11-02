// 遊戲大廳來訪紀錄（Vercel Serverless Function）
// POST {id}：記一次來訪（同瀏覽器同一天只算一位「今日訪客」，終身只算一位「累計訪客」，每次進站都累加「瀏覽量」）
// GET：只讀取數字，不計數
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
    var today = taipeiDay(0), id = null, isNew = false;
    if (req.method === 'POST'){
      var body = req.body; if (typeof body === 'string'){ try { body = JSON.parse(body); } catch (e) { body = {}; } }
      var raw = body && body.id ? String(body.id) : '';
      if (/^[A-Za-z0-9-]{16,64}$/.test(raw) && !BOT.test(req.headers['user-agent'] || '')) id = raw;
    }
    if (id){
      var r = await redis([
        ['SADD', 'lobby:visitors', id],
        ['SADD', 'lobby:dv:' + today, id],
        ['EXPIRE', 'lobby:dv:' + today, 60 * 86400],
        ['INCR', 'lobby:views']
      ]);
      isNew = r[0] === 1;
    }
    var days = []; for (var i = 6; i >= 0; i--) days.push(taipeiDay(i));
    var cmds = [['SCARD', 'lobby:visitors'], ['GET', 'lobby:views']];
    days.forEach(function(d){ cmds.push(['SCARD', 'lobby:dv:' + d]); });
    var out = await redis(cmds);
    var counts = days.map(function(d, k){ return +out[2 + k] || 0; });
    res.status(200).json({ ok: true, total: +out[0] || 0, views: +out[1] || 0, today: counts[6], isNew: isNew, last7: days.map(function(d, k){ return { d: d, n: counts[k] }; }) });
  } catch (e) {
    res.status(200).json({ ok: false, reason: 'error' });
  }
};
