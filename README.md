# 20261027_HKMold · 한국몰드 AI 오피스

픽셀아트 가상 사무실에서 한국몰드 AI 직원 6명과 대화하고 업무를 맡길 수 있는 웹앱입니다.

- 배포: https://20261027-hkmold.vercel.app (main 브랜치 push 시 자동 배포)
- GitHub: https://github.com/leoleo0813/20261027_HKMold

## 구성

| 경로 | 역할 |
| --- | --- |
| `index.html`, `style.css`, `app.js` | 사무실 화면(캔버스 픽셀아트)과 대화·업무 패널 |
| `lib/agents.js` | AI 직원 정의와 데모 응답 규칙 (브라우저·서버 공용) |
| `api/*.js` | Vercel 서버리스 함수. Neon Postgres에 대화와 업무 저장 |

## 데이터 저장

- `DATABASE_URL`(Neon) 환경 변수가 있으면 DB에 저장하고, 모든 방문자가 같은 사무실을 봅니다. 테이블은 첫 요청 때 자동으로 만들어집니다.
- DB가 없으면 화면 우측 상단에 "브라우저 저장 모드"로 표시되고, 데이터는 그 브라우저에만 저장됩니다.

## AI 응답

지금은 `lib/agents.js`의 키워드 규칙에 따른 데모 응답입니다. 실제 AI 모델을 붙일 때는 `agentReply`를 교체하면 됩니다.
