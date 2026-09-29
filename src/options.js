// 설정 화면. 필드 id 를 설정 키와 똑같이 맞춰서 반복문 하나로 처리한다.
import { DEFAULTS, getConfig, setConfig } from './lib/config.js';
import { applyI18n } from './lib/i18n.js';

applyI18n();

const KEYS = [
  'dedupe', 'matchMode', 'reloadOnDuplicate', 'sweepOnStart',
  'focusGuard',
  'autoGroup', 'groupTitle', 'groupColor', 'collapseGroup', 'viewMode', 'maxOpenTabs',
  'trackClaudeArtifacts',
];

const savedEl = document.getElementById('saved');
let savedTimer;

function flashSaved() {
  savedEl.classList.add('on');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => savedEl.classList.remove('on'), 1200);
}

const cfg = await getConfig();

for (const key of KEYS) {
  const node = document.getElementById(key);
  if (!node) continue;

  const isCheck = node.type === 'checkbox';
  if (isCheck) node.checked = cfg[key] ?? DEFAULTS[key];
  else node.value = cfg[key] ?? DEFAULTS[key];

  node.addEventListener('change', async () => {
    await setConfig({ [key]: isCheck ? node.checked : node.value });
    flashSaved();
  });
}
