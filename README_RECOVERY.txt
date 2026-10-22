Jcoupe Student Portal v1.8.5 - connection recovery

Root cause fixed:
- app.js had a JavaScript syntax error: "async async function saveTwoStagePhase3(...)"
- This prevented the module from executing, leaving the UI at the static text "연결 준비 중".

This ZIP is FLAT:
- index.html must be at the GitHub repository root.
- js/app.js must be at /js/app.js from the repository root.

Diagnostic status after deployment:
- 연결 준비 중 = new index.html is not being served/deployed
- 학생 포털 코드 불러오는 중 = new index loaded, app module loading
- 앱 로딩 오류 = app module/import file failed; error is shown on screen
- 수업 정보 연결 중 = app module executed, Firebase modules are loading
- 최신 정보 연결 = normal

Before upload, put your existing Google Apps Script /exec URL into js/drive-bridge-config.js.
