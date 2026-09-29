# Privacy Policy — Artifact Dock

_Last updated: 2026-09-29_

Artifact Dock does **not** collect, transmit, sell, or share any user data.

## What the extension reads

| Data | Why | Where it goes |
|---|---|---|
| URL and title of open tabs | To find tabs that show local HTML files (`file://…`) or Claude artifacts, detect duplicates, and list them in the side panel | Stays in your browser |
| Settings you choose (matching rule, group name, limits) | To remember your preferences | `chrome.storage` on your device |
| List of recently opened documents | To show the side panel list | `chrome.storage` on your device |

## Native messaging

The optional companion CLI (`artifact-open`) talks to the extension through Chrome native messaging
and a Unix socket **on your own machine**. It only sends a file path to open. Nothing leaves your computer.

## Network

The extension makes **no network requests** of its own. It contains no analytics, tracking, or remote code.

## Contact

Open an issue: https://github.com/woorichicken/artifact-dock/issues

---

## 개인정보 처리방침 (한국어)

Artifact Dock 은 어떤 사용자 데이터도 수집·전송·판매·공유하지 않습니다.
탭의 URL·제목은 로컬 HTML·Claude 아티팩트 탭을 찾고 중복을 합치는 데에만 쓰이며, 설정과 문서 목록은
브라우저의 `chrome.storage` 에만 저장됩니다. 확장 자체는 네트워크 요청을 하지 않고, 분석·추적 코드가 없습니다.
