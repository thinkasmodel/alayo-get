// ALAG-24：按运行器记下的阶段标记切分 Chrome netlog，列出每个阶段里有网络活动的外部请求与连接。
// 归因按「活动」而不是「开始时间」：一个请求或会话只要在某阶段内有任何事件（发请求头、上传、收数据、结束），
// 就算该阶段有它的活动；另外单列生命周期跨过该阶段的请求（开始早于、结束晚于该阶段）。
// 用法：node scripts/alag-24-translator-probe/netlog.mjs <netlog.json> <results.json>
import fs from 'node:fs';

const [netlogPath, resultsPath] = process.argv.slice(2);
let raw = fs.readFileSync(netlogPath, 'utf8').trimEnd();
let log;
try { log = JSON.parse(raw); } catch {
  // Chrome 被强行结束时文件没有收尾，补上再解析。
  raw = raw.replace(/,\s*$/, '');
  log = JSON.parse(raw + (raw.includes('"events"') ? ']}' : '}'));
}
const { marks } = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
const typeName = Object.fromEntries(Object.entries(log.constants.logEventTypes).map(([k, v]) => [v, k]));
const offset = Number(log.constants.timeTickOffset);
const phaseOf = (epochMs) => {
  let name = 'before-start';
  for (const m of marks) if (epochMs >= m.epochMs) name = m.name;
  return name;
};
const phaseNames = ['before-start', ...marks.map((m) => m.name)];
const isLocal = (h) => /^(127\.|localhost|\[::1\]|::1)/.test(h);
const hostOf = (s) => { try { return new URL(s).host; } catch { return s; } };

// 每个 source 的标签（主机、方法）与全部事件时间。
const sources = new Map();
for (const ev of log.events) {
  const id = ev.source.id;
  const t = typeName[ev.type];
  const p = ev.params || {};
  const src = sources.get(id) || { kind: null, host: null, method: null, url: null, times: [], sendPhases: new Set() };
  const epochMs = offset + Number(ev.time);
  src.times.push(epochMs);
  if (t === 'URL_REQUEST_START_JOB' && p.url) { src.kind = 'request'; src.url = p.url; src.host = hostOf(p.url); src.method = p.method; }
  else if ((t === 'HTTP2_SESSION' || t === 'HTTP2_SESSION_INITIALIZED') && p.host) { src.kind ||= 'h2-session'; src.host ||= String(p.host).replace(/:443$/, ''); }
  else if (t === 'QUIC_SESSION' && p.host) { src.kind ||= 'quic-session'; src.host ||= p.host; }
  else if (t === 'TCP_CONNECT_ATTEMPT' && p.address) { src.kind ||= 'tcp'; src.host ||= p.address; }
  if (/SEND_REQUEST|SEND_HEADERS|UPLOAD|BYTES_SENT/.test(t || '')) src.sendPhases.add(phaseOf(epochMs));
  sources.set(id, src);
}

const byPhase = Object.fromEntries(phaseNames.map((n) => [n, {}]));
for (const src of sources.values()) {
  if (!src.kind || !src.host || isLocal(src.host)) continue;
  const label = `${src.kind} ${src.method ? src.method + ' ' : ''}${src.host}`;
  const active = new Set(src.times.map(phaseOf));
  const first = phaseNames.indexOf(phaseOf(Math.min(...src.times)));
  const last = phaseNames.indexOf(phaseOf(Math.max(...src.times)));
  for (let i = first; i <= last; i++) {
    const ph = phaseNames[i];
    const e = (byPhase[ph][label] ||= { active: 0, spanning: 0, sent: 0, samples: [] });
    if (active.has(ph)) e.active++; else e.spanning++;
    if (src.sendPhases.has(ph)) e.sent++;
    if (src.url && e.samples.length < 2 && !e.samples.includes(src.url.slice(0, 120))) e.samples.push(src.url.slice(0, 120));
  }
}
console.log(JSON.stringify({ marks: marks.map((m) => m.name), byPhase }, null, 2));
