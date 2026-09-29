// 다국어 헬퍼. 문구 원본은 _locales/<lang>/messages.json 이고 Chrome 이 브라우저 언어로 고른다
// (없는 언어면 manifest 의 default_locale = en).
//
// 키가 없을 때 빈 문자열이 화면에 나가면 "버튼이 사라진" 것처럼 보여서 원인을 못 찾는다.
// 그래서 키 이름을 그대로 보여준다 — tests/i18n.test.mjs 가 누락을 미리 잡는다.

export function t(key, ...subs) {
  const msg = chrome.i18n.getMessage(key, subs.map(String));
  return msg || key;
}

/**
 * 정적 HTML 의 문구를 채운다.
 *   data-i18n="key"             → textContent
 *   data-i18n-html="key"        → innerHTML (<b>·<code> 가 든 우리 번역문 전용. 사용자 데이터에는 쓰지 않는다)
 *   data-i18n-placeholder="key" → placeholder
 *   data-i18n-title="key"       → title
 */
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((n) => (n.textContent = t(n.dataset.i18n)));
  root.querySelectorAll('[data-i18n-html]').forEach((n) => (n.innerHTML = t(n.dataset.i18nHtml)));
  root.querySelectorAll('[data-i18n-placeholder]').forEach((n) => (n.placeholder = t(n.dataset.i18nPlaceholder)));
  root.querySelectorAll('[data-i18n-title]').forEach((n) => (n.title = t(n.dataset.i18nTitle)));
  document.documentElement.lang = chrome.i18n.getUILanguage();
}

/** 에이전트에게 붙여넣을 프롬프트를 클립보드에 넣는다. 성공 여부를 돌려준다. */
export async function copyAgentPrompt() {
  try {
    await navigator.clipboard.writeText(t('agentPrompt'));
    return true;
  } catch {
    return false;
  }
}
