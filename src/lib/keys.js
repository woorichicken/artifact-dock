// "이 탭이 관리 대상인가", "두 탭이 같은 문서인가"를 판정하는 규칙 모음.
// dedup 로직 전체가 이 키 하나에 달려 있어서 별도 파일로 뺐다.

const HTML_EXT = /\.(html?|xhtml)$/i;

// macOS 에서 /tmp · /var · /etc 는 /private/… 의 심링크다.
// Chrome 이 어느 쪽 형태로 URL 을 만드느냐에 따라 **같은 파일이 두 문서로 갈려서**
// 중복 탭이 합쳐지지 않는다. 실측: /tmp/claude-501 과 /private/tmp/claude-501 은 같은 디렉토리.
const MACOS_PRIVATE_LINK = /^\/private(\/(?:tmp|var|etc)(?:\/|$))/;

/** file:// URL 에서 사람이 읽는 경로를 뽑는다. (%20 같은 인코딩 복원 + 심링크 정규화) */
export function filePathOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'file:') return null;
    return decodeURIComponent(u.pathname).replace(MACOS_PRIVATE_LINK, '$1');
  } catch {
    return null;
  }
}

// 아티팩트 URL 은 형태가 여러 가지다. 실제로 본 것들:
//   claude.ai/code/artifact/<id>?via=auto_preview   ← Claude Code 가 만든 것
//   claude.ai/public/artifacts/<id>                 ← 공개 아티팩트
//   claude.site/artifacts/<id>                      ← 예전 공유 도메인
// 단수/복수(artifact / artifacts)가 섞여 있어서 둘 다 받는다.
const ARTIFACT_HOSTS = /(^|\.)(claude\.ai|claude\.site)$/;
const ARTIFACT_PATHS = [
  /^\/code\/artifacts?\/([\w-]+)/,
  /^\/public\/artifacts?\/([\w-]+)/,
  /^\/artifacts?\/([\w-]+)/,
];

/** Claude 아티팩트면 아티팩트 id 를, 아니면 null */
function claudeArtifactId(url) {
  try {
    const u = new URL(url);
    if (!ARTIFACT_HOSTS.test(u.hostname)) return null;
    for (const re of ARTIFACT_PATHS) {
      const m = u.pathname.match(re);
      if (m) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 같은 문서면 같은 문자열이 나오는 키.
 * title 은 matchMode 가 'title' 일 때만 쓰인다 (없으면 경로로 판정).
 * 쿼리스트링·해시는 일부러 버린다 — 에이전트가 ?t=1699.. 같은 캐시버스터를 붙여도 같은 문서로 봐야 하니까.
 * 대상이 아니면 null 을 돌려주고, 호출부는 null 이면 손대지 않는다.
 */
export function artifactKey(url, cfg, title) {
  if (!url) return null;

  const path = filePathOf(url);
  if (path && HTML_EXT.test(path)) {
    // 제목 기준: 파일명이 제각각이어도 같은 리포트면 합친다.
    // 단 탭이 막 열린 순간에는 제목이 없으므로 그때는 경로로 떨어진다.
    if (cfg.matchMode === 'title' && title && !title.endsWith('.html')) {
      return 'title:' + title.trim();
    }
    if (cfg.matchMode === 'filename') {
      return 'file:' + path.split('/').pop();
    }
    return 'file:' + path;
  }

  if (cfg.trackClaudeArtifacts) {
    const id = claudeArtifactId(url);
    if (id) return 'artifact:' + id;
  }

  return null;
}

/** 사이드바에 보여줄 표시용 이름 */
export function displayName(url, title) {
  const path = filePathOf(url);
  if (path) {
    const base = path.split('/').pop();
    // 제목이 파일명과 사실상 같으면 파일명만 보여준다 (중복 표기 방지)
    if (title && title !== base && !title.startsWith('file://')) return title;
    return base;
  }
  return title || url;
}

/** 사이드바 부제용: 파일이면 상위 디렉토리, 아니면 호스트 */
export function subLabel(url) {
  const path = filePathOf(url);
  if (path) {
    const dir = path.slice(0, path.lastIndexOf('/'));
    return dir.replace(HOME_RE, '~');
  }
  try {
    const u = new URL(url);
    if (ARTIFACT_HOSTS.test(u.hostname)) return 'Claude 아티팩트';
    return u.hostname;
  } catch {
    return '';
  }
}

// 확장 프로그램은 사용자의 홈 경로를 모른다. /Users/<name> 패턴을 ~ 로 줄여서 부제를 짧게 만든다.
const HOME_RE = /^\/Users\/[^/]+/;
