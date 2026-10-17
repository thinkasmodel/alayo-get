/* global chrome, probe */
// 内容脚本：在 127.0.0.1 的测试页上（有无 Permissions-Policy 两种）探测可用性并试翻译一句。
(async () => {
  const id = 'cs:' + location.pathname;
  const data = { env: probe.env(), docPolicy: null };
  try {
    const fp = document.featurePolicy || document.permissionsPolicy;
    if (fp) data.docPolicy = { translator: fp.allowsFeature('translator'), languageDetector: fp.allowsFeature('language-detector') };
  } catch (e) { data.docPolicy = { error: String(e) }; }
  if (data.env.hasTranslator) {
    data.availability = await probe.availability([['en', 'zh']]);
    data.translate = await probe.translate('en', 'zh', 'The library opens at nine in the morning.');
    data.detect = await probe.detect('这是一段用来检测语言的中文句子。');
  }
  chrome.runtime.sendMessage({ type: 'report', id, data });
})();
