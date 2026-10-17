/* global chrome, probe */
// offscreen 文档：收到命令就跑对应探测，把结果报回 SW。
const report = (id, data) => chrome.runtime.sendMessage({ type: 'report', id, data });

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== 'offscreen') return;
  (async () => {
    const a = msg.args || {};
    let data;
    try {
      switch (msg.cmd) {
        case 'env': data = probe.env(); break;
        case 'availability': data = await probe.availability(a.pairs); break;
        case 'create': data = await probe.create(a.s, a.t, a.timeoutMs); break;
        case 'translate': data = await probe.translate(a.s, a.t, a.text); break;
        case 'stream': data = await probe.stream(a.s, a.t, a.text); break;
        case 'long': data = await probe.long(a.s, a.t, a.paragraphs); break;
        case 'detect': data = await probe.detect(a.text); break;
        case 'worker': data = await new Promise((resolve) => {
          const w = new Worker('worker.js');
          w.postMessage(a);
          w.onmessage = (ev) => { resolve(ev.data); w.terminate(); };
          w.onerror = (ev) => { resolve({ error: String(ev.message) }); w.terminate(); };
        }); break;
        default: data = { error: 'unknown cmd ' + msg.cmd };
      }
    } catch (e) { data = { thrown: { name: e.name, message: e.message } }; }
    report(msg.id, data);
  })();
});
report('offscreen:loaded', probe.env());
