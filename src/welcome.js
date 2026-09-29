// 설치 안내. 각 단계의 완료 여부를 사용자가 체크하게 두지 않고 브라우저에 직접 물어본다
// — "했다고 생각했는데 안 된" 상태(파일 접근 꺼짐·CLI 미연결)를 화면이 그대로 보여줘야 해서다.
import { t, applyI18n } from './lib/i18n.js';

const INSTALL_CMD =
  'git clone https://github.com/woorichicken/artifact-dock.git ~/artifact-dock && ~/artifact-dock/install.sh';
// install.sh 를 막 실행한 사람이 곧바로 초록불을 볼 수 있을 만큼 자주, 그러나 계속 돌아도 부담 없게.
const POLL_MS = 2000;
const COPIED_MS = 1500;

applyI18n();
document.getElementById('installCmd').textContent = INSTALL_CMD;
document.getElementById('agentPromptText').textContent = t('agentPrompt');

const STATE_LABEL = { done: 'stateDone', todo: 'stateTodo', waiting: 'stateWaiting', optional: 'stateOptional' };

function setStep(id, state) {
  const li = document.getElementById(id);
  li.dataset.state = state;
  li.querySelector('.state').textContent = t(STATE_LABEL[state]);
}

async function refresh() {
  const fileOk = await chrome.extension.isAllowedFileSchemeAccess();
  const res = await chrome.runtime.sendMessage({ type: 'dock:status' }).catch(() => null);
  const cliOk = !!res?.hostReady;

  setStep('step-install', 'done');
  setStep('step-file', fileOk ? 'done' : 'todo');
  setStep('step-cli', cliOk ? 'done' : 'waiting');
  setStep('step-agent', 'optional');

  const ready = fileOk && cliOk;
  const summary = document.getElementById('summary');
  summary.className = 'summary ' + (ready ? 'ok' : 'pending');
  summary.textContent = ready ? `✓ ${t('allReady')}` : t('notReady');
}

document.getElementById('openExtSettings').addEventListener('click', () => {
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
});

document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const text = document.getElementById(btn.dataset.copy).textContent;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = t('copied');
    } catch {
      btn.textContent = t('toastCopyFail');
    }
    setTimeout(() => (btn.textContent = t('copy')), COPIED_MS);
  });
});

refresh();
setInterval(refresh, POLL_MS);
// 확장 설정 탭에서 토글을 켜고 돌아오면 바로 반영되게.
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
