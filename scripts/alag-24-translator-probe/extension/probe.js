/* global chrome, probe */
// 扩展自有页面。?nogesture=s>t 时在加载时（无手势）直接 create；按钮点击时对 window.pendingPair 做 create（有手势）。
const report = (id, data) => chrome.runtime.sendMessage({ type: 'report', id, data });
const q = new URLSearchParams(location.search);
const tag = q.get('tag') || 'page';
report(`${tag}:env`, probe.env());
const ng = q.get('nogesture');
if (ng) {
  const [s, t] = ng.split('>');
  probe.create(s, t, 120000).then((r) => report(`${tag}:nogesture-create`, r));
}
window.pendingPair = null;
document.getElementById('go').addEventListener('click', () => {
  const p = window.pendingPair;
  if (!p) return;
  const [s, t] = p.split('>');
  const id = `${tag}:gesture-create:${p}:${Date.now()}`;
  window.lastId = id;
  if (p === 'detector') probe.detect('这是一段用来检测语言的中文句子。').then((r) => report(id, r));
  else probe.create(s, t).then((r) => report(id, r));
});
window.runTranslate = (id, s, t, text) => probe.translate(s, t, text).then((r) => report(id, r));
