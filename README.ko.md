# Artifact Dock (한국어)

> [English](README.md) · [Chrome 웹스토어](https://chromewebstore.google.com/detail/artifact-dock/nfifnjdpmjacfelfapgeibnnbkokceim) · [데모 영상](docs/media/artifact-dock-demo.mp4)


에이전트가 열어대는 로컬 HTML·Claude 아티팩트를 **포커스 안 뺏고 / 탭 하나만 / 사이드바 목록으로** 다루는 Chrome 확장 + CLI.

## 해결하는 것

| 증상 | 원인 | 이 프로젝트의 처리 |
|---|---|---|
| 파일 열 때마다 화면이 Chrome으로 넘어감 | `open` 이 **Chrome 앱 자체를** 앞으로 가져옴 | CLI가 소켓으로 확장에 부탁 → 확장이 `tabs.create({active:false})` 로 **백그라운드 탭** 생성 |
| 같은 리포트를 열 때마다 새 탭 | dedup 없음 | 파일 경로(또는 파일명) 기준으로 기존 탭 재사용 + 새로고침 |
| 탭이 많아 파비콘만 보임 | 탭바 포화 | 사이드 패널 목록 + 탭그룹으로 한 덩어리 |

### 왜 CLI만으로는 안 되나 (실측)

`open -g` (앱을 앞으로 안 가져오는 플래그)도, AppleScript `make new tab` 만으로도 **Chrome은 스스로 앞으로 나온다.**

```
base=Finder  →  0.3s: Google Chrome  0.7s: Google Chrome   ← open -g 를 써도 이렇다
```

확장이 연결돼 있을 때만 연다. `tabs.create({active:false})`로 백그라운드 탭을 만들고,
경로·파일명·제목 규칙으로 기존 탭을 재사용한다.

확장이 연결되지 않거나 응답이 실패하면 CLI도 실패한다. 예전 AppleScript 대체 경로는
2026-09-23에 제거했다. 포커스를 복원하려 시도하는 것보다 직접 열기를 시작하지 않는 것이 확실하다.

## 설치

확장은 Chrome 웹스토어 또는 소스(압축해제 로드) 중 하나로 설치한다. **어느 쪽이든 CLI·네이티브 호스트는
`install.sh` 로 따로 깐다** — 확장은 로컬 프로그램을 설치할 수 없어서다.

```bash
git clone https://github.com/woorichicken/artifact-dock.git
cd artifact-dock
./install.sh
```

`host/.extension-id` 에 적힌 확장 ID(소스 로드용 · 웹스토어용)를 모두 허용하므로 둘 중 무엇으로 깔아도 연결된다.

소스로 로드할 때는 Chrome에서:

1. `chrome://extensions` → 우측 상단 **개발자 모드** 켜기
2. **압축해제된 확장 프로그램을 로드** → 이 폴더 선택
3. 확장 상세에서 **"파일 URL에 대한 액세스 허용"** 켜기 (로컬 HTML을 다루므로)
4. 확인:

```bash
artifact-open --status     # "확장 연결: 살아있음" 이면 끝
```

> `--status` 가 "없음"이면 확장을 껐다 켜세요. 네이티브 호스트는 확장이 켜질 때 실행됩니다.

## 처음 설치하면

설치 직후 **설치 안내 탭**이 열린다. 파일 URL 접근·CLI 연결을 브라우저에 직접 물어 완료 여부를 표시하고,
에이전트에게 붙여넣을 프롬프트를 복사할 수 있다. 사이드바의 🤖 로도 같은 프롬프트를 복사한다.
닫은 뒤에는 설정 맨 위 「설치 안내 다시 보기」.

화면 언어는 브라우저 언어를 따른다 — 한국어·English·Español, 그 외는 영어. 문구 원본은 `_locales/<lang>/messages.json`.

## 사용

```bash
artifact-open report.html          # 백그라운드로 열기 (같은 파일이면 기존 탭 새로고침)
artifact-open a.html b.html        # 여러 개
artifact-open -f report.html       # 이번만 포커스 주면서
artifact-open --status
```

사이드바는 툴바 아이콘 클릭 또는 `Cmd+Shift+U`.

### 에이전트에게 설정 맡기기

설치 안내 4단계(또는 사이드바 🤖)에서 **설정 프롬프트**를 복사해 Claude Code·Codex 대화에 붙여넣는다.
에이전트가 직접 한다: 저장소 clone → `install.sh` → 셸 설정(`~/.zshrc`)에서 `~/.local/bin` 을 `/usr/bin`
앞에 두기 → `command -v open`·`artifact-open --status` 확인 → 임시 HTML 로 백그라운드 열기 확인.

지시문을 CLAUDE.md 에 적어 두는 방식 대신 **`open` 자체를 가로채는** 쪽을 택했다. 에이전트가 지시를
잊어도, 스크립트·Node 가 `open` 을 직접 불러도 같은 경로를 타기 때문이다(아래 절).

### HTML 직접 열기 차단 (2026-09-23)

`./install.sh --cli-only`는 기존 네이티브 호스트 등록을 건드리지 않고
`~/.local/bin/artifact-open`과 `~/.local/bin/open`만 연결한다. 기존의 다른 실행 파일은
덮어쓰지 않고 설치를 중단한다. `~/.local/bin`은 `/usr/bin`보다 PATH에서 앞에 있어야 한다.

- `open 보고서.html`과 Node `execFileSync("open", [파일])`도 실행 파일 래퍼를 통해
  Artifact Dock으로 간다. `.zshrc` 함수만으로는 Node의 직접 실행을 가로챌 수 없다.
- `.html`/`.htm`은 대소문자와 file/HTTP URL의 쿼리·프래그먼트를 구분한다.
  `-g`와 `-a 앱`/`-b 번들`은 받아도 HTML은 확장을 통해 백그라운드로 연다.
  HTML의 미지원 옵션이나 HTML+다른 파일 혼합 요청은 실행 전에 거부한다.
- HTML이 아닌 명령은 인자를 그대로 `/usr/bin/open`에 전달한다.
- 확장 미연결·오류·잘못된 응답이면 `artifact-open`은 실패로 종료한다.
  AppleScript나 macOS `open`으로 자동 대체하지 않는다. 예전 `_open_quietly.py`도 같은 규칙을 따른다.
- `/usr/bin/open` 절대경로 호출이나 PATH를 바꾸는 프로그램까지 막는 OS 보안 장치는 아니다.
  HTML 제작 스크립트의 직접 opener 호출도 회귀 검사해야 한다.

검증: `python3 tests/open_guard.test.py`. 가짜 소켓과 실행 명령으로 성공·실패·Node 경로를
검사하므로 실제 Chrome은 열리지 않는다. 제거는 `./install.sh --uninstall`이며 자기 CLI 링크만 지운다.

## 이미 열려 있는 탭 정리

dedup 은 **새로 열 때**만 동작한다. 확장을 켜기 전부터 쌓여 있던 탭은 사이드바 하단 **[정리]** 버튼으로 치운다.

- 같은 문서를 가리키는 탭을 하나만 남기고 닫는다 (활성 탭 > Chrome 고정탭 > 최근에 본 탭 순으로 남김)
- **파일이 지워진** 항목을 목록에서 지우고 그 탭을 닫는다 (`/tmp` 의 리포트는 재부팅·정리로 사라진다)
- 흩어진 아티팩트 탭을 탭그룹 하나로 모은다
- 설정에서 **브라우저 켤 때 자동 정리** 로 바꿀 수 있다

목록에서 같은 문서는 한 줄로 묶여 `×3` 배지가 붙는다. 배지를 누르면 그 문서의 중복만 닫는다.

> 제목은 같은데 파일명이 다른 리포트가 쌓인다면 설정에서 **같은 문서 판정 기준 → 문서 제목** 으로 바꾼다.

### 지워진 파일 · 오래된 문서

확장은 `file://` 파일이 아직 있는지 알 수 없어서 네이티브 호스트에게 묻는다(존재만 보고 내용은 읽지 않는다).
파일이 없는 항목은 취소선과 **삭제됨** 표시가 붙고, 누르면 "파일을 찾을 수 없음" 페이지 대신 안내가 뜬다.

| 설정 | 기본 | 하는 일 (한 시간에 한 번 + 브라우저를 켤 때) |
|---|---|---|
| 지워진 파일 자동 정리 | 켬 | 지워진 파일을 **최근 닫힘**에서 지운다. 열린 탭은 [정리]를 누를 때만 닫는다 |
| 오래된 문서 자동 정리 (일) | 0 (끔) | N일 동안 다시 열지도 *보지도* 않은 문서는 탭을 닫고 목록에서도 지운다 |

📌 고정한 문서 · 보고 있는 탭 · Chrome 고정 탭은 지우지 않는다.
존재 확인은 **0.5.0 호스트**가 있어야 한다 — `git pull` 뒤 확장을 껐다 켜서 새 호스트를 띄운다.
옛 호스트면 표시도 정리도 하지 않는다.

## 사이드바 목록

- **최신순** — 탭 위치가 아니라 에이전트가 문서를 마지막으로 열거나 다시 쓴 시각 순이다.
  목록에서 문서를 골라도 순서가 바뀌지 않는다(「한 개만 꺼내기」는 탭을 그룹 밖으로 꺼냈다 넣어서,
  탭 순서를 따르던 예전 목록은 고를 때마다 뒤섞였다).
- **검색**은 제목·폴더·전체 경로에서 찾는다. macOS 파일 이름(자모 분리형 NFD)도 한글로 찾히고,
  입력 중인 마지막 글자는 너그럽게 맞춰서 조합하는 동안 결과가 깜빡이지 않는다.
- 목록은 아티팩트 탭이 바뀔 때만 다시 그린다. 다른 사이트 탭의 제목 변화(메일·메신저의 안 읽음 수)로는
  다시 그리지 않는다.

## 탭바가 파비콘으로 뒤덮이는 문제

Chrome 은 **접힌 그룹 안의 탭을 활성화하면 그룹을 통째로 펼친다.** 막을 방법이 없고,
활성 탭이 든 그룹은 다시 접는 것도 거부한다. 그래서 두 가지로 우회한다.

| 설정 | 동작 |
|---|---|
| **한 개만 꺼내기** (기본) | 볼 탭만 그룹 밖으로 빼내 보여준다. 나머지는 접힌 채 그대로. 그 탭을 벗어나면 조용히 그룹으로 돌려보낸다 |
| | ↳ `ungroup` 과 활성화는 **그 자체로 그룹을 펼친다.** 그래서 원래 접혀 있었는지 기억해 뒀다가, 탭이 그룹 밖으로 나온 뒤(= 접기가 허용되는 유일한 시점) 반드시 되돌린다 |
| | ↳ **탭을 그룹에 넣을 때도 펼쳐진다.** 접힘 복원은 `groupTabs()` 한 곳에서만 하고 모든 경로가 그걸 통과한다 |
| | ↳ 꺼내 둔 탭은 기록이 아니라 **실제 상태**로 되돌린다 — "그룹 밖에 있는 아티팩트 탭"을 매번 훑어서 집어넣는다. 서비스 워커가 죽어 기록이 끊겨도 탭이 밖에 남지 않는다 |
| 그룹 펼치기 | 평범하게 활성화한다. 대신 다른 탭으로 나가는 순간 그룹을 자동으로 다시 접는다 |

탭 수 자체를 줄이려면 **아티팩트 탭 최대 개수**를 정한다. 넘으면 오래 안 본 것부터 닫히는데,
사이드바 목록에는 남아서 클릭 한 번으로 되살아난다. 고정(📌)한 문서와 보고 있는 탭은 닫지 않는다.
하단 **[탭 비우기]** 도 같다 — 탭만 닫고 목록은 남긴다.

## 같은 문서인데 안 합쳐질 때

- **macOS 심링크**: `/tmp` 는 `/private/tmp` 의 심링크라 Chrome 이 어느 형태로 URL 을 만드느냐에
  따라 같은 파일이 두 문서로 갈렸다. `/tmp`·`/var`·`/etc` 는 `/private` 접두사를 떼고 판정한다.
- **파일명은 같고 경로가 다르면** 기본(전체 경로)에서는 별개 문서다. 설정에서 `파일 이름만` 또는
  `문서 제목` 으로 바꾼다.

## [정리]가 안 끌고 가는 탭

| 탭 | 이유 |
|---|---|
| 지금 보고 있는 탭 | solo 모드에선 일부러 그룹 밖에 둔다(넣으면 그룹이 펼쳐진다) |
| Chrome 탭 고정한 탭 | 고정탭은 그룹에 못 들어간다 |
| 다른 창의 탭 | 창을 넘겨 옮기지 않는다. 그 창에 그룹이 따로 생긴다 |
| HTML 이 아닌 `file://` | PDF·이미지 등은 대상이 아니다 |

## Chrome 웹스토어에 올리기 (관리자)

`scripts/publish-cws.mjs` 가 `scripts/build-cws.sh` 로 만든 zip 을 올리고 심사에 제출한다.
[Chrome Web Store API v2](https://developer.chrome.com/docs/webstore/using-api)(스코프
`https://www.googleapis.com/auth/chromewebstore`)를 쓰고, 의존성 없이 Node 18+ `fetch` 만 쓴다.

### 한 번 설정

콘솔에서 할 일 (스크립트가 대신할 수 없다):

1. **Google Cloud 콘솔** → 프로젝트를 만들거나 고르고 → API 및 서비스 → **Chrome Web Store API** 사용 설정.
2. **OAuth 동의 화면**: 사용자 유형 **외부**, 앱 이름·이메일을 채우고, 스토어 항목을 가진 Google 계정을
   **테스트 사용자**에 추가한다. 외부 + **테스트** 상태의 앱은 refresh token 이 7일 뒤 만료된다(Google 문서).
   매주 6번을 다시 하기 싫으면 게시 상태를 **프로덕션**으로 바꾼다.
3. **사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID → 데스크톱 앱.** 데스크톱 클라이언트라야
   도우미가 쓰는 루프백 리다이렉트(`http://127.0.0.1:<포트>`)가 허용된다. 클라이언트 ID·시크릿을 보관한다.
4. **Chrome 웹스토어 개발자 대시보드 → 퍼블리셔 → 설정** → **퍼블리셔 ID** 를 복사한다. 게시하는 계정은
   2단계 인증이 켜져 있어야 한다.

그다음 터미널에서:

5. 편집기로 `~/.config/artifact-dock/cws.env` 를 만든다 (저장소 밖, `chmod 600`):
   ```bash
   CWS_CLIENT_ID='…'
   CWS_CLIENT_SECRET='…'
   CWS_PUBLISHER_ID='…'
   ```
6. refresh token 을 한 번 받는다 — Google 로그인 주소를 출력하고 `127.0.0.1` 에서 기다렸다가, 승인되면
   `CWS_REFRESH_TOKEN` 을 같은 파일에 권한 600 으로 적는다. 토큰 값은 출력하지 않는다(로그인 주소에는
   클라이언트 ID 만 들어간다 — OAuth 가 어차피 브라우저로 보내는 공개값이다).
   ```bash
   (set -a; . ~/.config/artifact-dock/cws.env; set +a; node scripts/cws-auth.mjs)
   ```

### 매 릴리스 — 한 줄

`manifest.json` 의 `version` 을 올린 뒤:

```bash
scripts/build-cws.sh && (set -a; . ~/.config/artifact-dock/cws.env; set +a; node scripts/publish-cws.mjs)
```

액세스 토큰 갱신 → 업로드 → 업로드가 `IN_PROGRESS` 면 끝날 때까지 확인 → 심사 제출 → 심사 상태
(`PENDING_REVIEW` → `PUBLISHED`) 출력까지 한다. 실패하면 다음에 할 일이 담긴 문장으로 나온다
(토큰 만료 · API 꺼짐 · 퍼블리셔 ID 틀림 · 버전 안 올림).

| 옵션 | |
|---|---|
| `--dry-run` | 네트워크 없이 zip · 비어 있는 환경변수 · 보낼 요청만 보여 준다 |
| `--status` | 지금 심사 상태만 본다 |
| `--no-publish` | 업로드만 하고 제출하지 않는다 |
| `--staged` | 승인 뒤 바로 게시하지 않고 대기(`STAGED_PUBLISH`) |
| `--zip <경로>` | 다른 zip 을 올린다 (기본 `dist/artifact-dock-<버전>.zip`) |

환경변수: `CWS_CLIENT_ID` · `CWS_CLIENT_SECRET` · `CWS_REFRESH_TOKEN` · `CWS_PUBLISHER_ID`, 선택으로
`CWS_EXTENSION_ID`(기본 `nfifnjdpmjacfelfapgeibnnbkokceim` = 스토어 항목). 환경변수로만 받고 값은 출력하지 않는다.

## 문제가 생기면

```bash
./doctor.sh        # 호스트 등록·프로세스·소켓·CLI·Chrome 을 한 번에 점검
```

사이드바 왼쪽 아래에 `26개 열림 · 한 개만 · v0.5.0` 처럼 **버전과 모드**가 찍힌다.
확장을 고친 뒤에는 이 버전이 올라갔는지부터 본다 — 안 올라갔으면 `chrome://extensions` 에서
⟳ 를 누르지 않은 것이고, 그 상태에서 무엇을 고쳐도 반영되지 않는다.

## 설정 (확장 아이콘 → ⚙)

| 항목 | 기본 | 설명 |
|---|---|---|
| 같은 문서 판정 | 전체 경로 | `파일 이름만`(경로 무시) / `문서 제목`(파일명이 달라도 title 이 같으면) 로 바꿀 수 있음 |
| 재사용할 때 새로고침 | 켬 | 에이전트가 파일을 다시 썼을 테니 |
| 포커스 가드 | 켬 | 외부에서 열린 탭이면 직전 탭으로 되돌림. 페이지 내 링크 클릭은 건드리지 않음 |
| 탭 그룹 | 켬 | 그룹 이름·색. 기본으로 **접어둔다** |
| 사이드바에서 볼 때 | 한 개만 꺼내기 | 탭바가 펼쳐지지 않게 그 탭만 그룹 밖으로 |
| 아티팩트 탭 최대 개수 | 0 (무제한) | 넘으면 오래된 것부터 닫음 (목록은 유지) |
| 시작할 때 자동 정리 | 끔 | 브라우저를 켤 때 중복 탭을 자동으로 닫음 |
| 지워진 파일 자동 정리 | 켬 | 파일이 지워진 항목을 '최근 닫힘'에서 지움 (0.5.0 호스트 필요) |
| 오래된 문서 자동 정리 | 0일 (끔) | N일 동안 열지도 보지도 않은 문서를 닫고 목록에서 지움 |
| Claude 아티팩트 | 켬 | `claude.ai/code/artifact/…`, `/public/artifacts/…`, `claude.site/artifacts/…` 를 함께 관리. 끄면 로컬 파일만 |

## 구조

```
manifest.json            확장 매니페스트 (key 고정 → ID 가 항상 hanplflofffhnolmbildckncaclkjbmf)
src/background.js        dedup · 포커스 복원 · 탭그룹 · 네이티브 호스트 연결
src/lib/keys.js          "같은 문서인가" 판정 규칙 (dedup 의 핵심)
src/lib/config.js        설정 기본값
src/lib/search.js        사이드바 검색 (NFC 맞춤, 한글 조합 중 글자)
src/lib/cleanup.js       지워진 파일·오래된 문서 정리가 무엇을 지울지
src/sidepanel.*          사이드바 목록 UI
src/options.*            설정 화면
host/artifact_dock_host.py   CLI(unix socket) ↔ 확장(native messaging) 다리
bin/artifact-open        CLI. 소켓 실패 시 nonzero 중단(직접 열기 금지)
install.sh               네이티브 호스트 등록 + CLI 링크 (--uninstall 로 제거)
scripts/build-cws.sh     웹스토어 업로드용 zip (manifest key 제거) → dist/
scripts/publish-cws.mjs  그 zip 을 올리고 심사에 제출 (Chrome Web Store API v2)
scripts/cws-auth.mjs     refresh token 을 처음 한 번 받기 (루프백 OAuth, 저장소 밖에 저장)
PRIVACY.md               개인정보 처리방침 (웹스토어 등록 필수)
docs/backlog.md          일부러 미룬 작은 결함 (근거·다시 볼 조건과 함께)
run-tests.sh             확장 없이 돌릴 수 있는 검증
```

## 검증

```bash
./run-tests.sh
```

- `tests/i18n.test.mjs` — 언어별 키·치환자 일치, 코드가 쓰는 키 존재, en/es 에 한글 잔존 없음, 스토어 글자 수 제한
- `tests/keys.test.mjs` — dedup 키 규칙 14케이스 (쿼리 무시, 파일명 모드, 한글/공백, 비대상 판정)
- `tests/search.test.mjs` — 한글 검색: NFD 파일명, %인코딩 폴더, 조합 중인 마지막 글자
- `tests/cleanup.test.mjs` — 정리가 지우는 것과 남겨야 하는 것(📌 고정 · 보고 있는 탭 · Chrome 고정 탭)
- `tests/host.test.py` — 호스트를 Chrome 인 척 띄워 CLI→호스트→확장 왕복 실측 + 확장→호스트 파일 존재 확인
- `tests/open_guard.test.py` — Node/셸 HTML 라우팅, 실패 시 직접 열기 금지, CLI 설치 충돌 검사
- `tests/cws.test.mjs` — 가짜 `fetch` 로 웹스토어 스크립트 검사: 요청 순서·모양, `IN_PROGRESS` 대기,
  사람이 읽을 실패 문장, 어떤 출력에도 자격증명 값 없음, 루프백 로그인 왕복

확장 안에서 도는 것(백그라운드 탭 생성, 포커스 복원, 탭그룹)은 브라우저에 로드해야 확인된다.

## 알려진 한계

- **macOS 전용**. HTML이 아닌 파일의 `/usr/bin/open` 위임과 소켓 경로가 macOS 기준.
- Chrome 창이 **하나도 없을 때** 여는 경우, 새 창은 `focused:false` 로 만들지만 OS가 앱을 앞으로 낼 수 있다.
- 파일 내용이 바뀌어도 **자동 새로고침은 하지 않는다**. 같은 경로로 다시 `artifact-open` 하면 새로고침된다.
- 네이티브 호스트는 확장이 켜져 있을 때만 산다. 연결이 없으면 CLI는 오류로 중단한다.
