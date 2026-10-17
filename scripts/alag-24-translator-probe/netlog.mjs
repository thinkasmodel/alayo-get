// ALAG-24：按运行器记下的阶段标记切分 Chrome netlog，列出每个阶段访问过的外部主机。
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
const isLocal = (h) => /^(127\.|localhost|\[::1\]|::1)/.test(h);
const hostOf = (s) => { try { return new URL(s).host; } catch { return s; } };

const byPhase = {};
const add = (phase, kind, host, detail) => {
  if (!host || isLocal(host)) return;
  const p = (byPhase[phase] ||= {});
  const k = `${kind} ${host}`;
  const e = (p[k] ||= { count: 0, samples: [] });
  e.count++;
  if (detail && e.samples.length < 3 && !e.samples.includes(detail)) e.samples.push(detail);
};
for (const ev of log.events) {
  const t = typeName[ev.type];
  const epochMs = offset + Number(ev.time);
  const phase = phaseOf(epochMs);
  const p = ev.params || {};
  if (t === 'URL_REQUEST_START_JOB' && p.url) add(phase, 'request', hostOf(p.url), p.url.slice(0, 120));
  else if (t === 'HOST_RESOLVER_DNS_TASK' || t === 'HOST_RESOLVER_MANAGER_REQUEST') { if (p.host) add(phase, 'dns', hostOf(p.host), null); }
  else if (t === 'TCP_CONNECT_ATTEMPT' && p.address) add(phase, 'tcp', p.address, null);
  else if (t === 'QUIC_SESSION' && p.host) add(phase, 'quic', p.host, null);
  else if (t === 'PROXY_RESOLUTION_SERVICE_RESOLVED_PROXY_LIST' && p.proxy_info) add(phase, 'proxy', String(p.proxy_info), null);
}
console.log(JSON.stringify({ marks: marks.map((m) => m.name), byPhase }, null, 2));
