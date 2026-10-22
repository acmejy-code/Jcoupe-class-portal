Jcoupe 학생 포털 v1.8.4 - '연결 준비 중' 긴급 복구본
====================================================

[원인]
기존 v1.8.2 정식통합 ZIP 일부 배포본에서 index.html은 ./js/app.js를 호출하지만
ZIP 내부에 js/app.js, js/firebase-config.js, js/portal-config.js 등이 누락되어
JavaScript가 시작되지 않고 화면이 '연결 준비 중'에서 멈추는 문제가 확인됨.

[이번 복구본]
- 학생 포털만 수정
- Firebase 프로젝트/Firestore 데이터/관리자 포털 변경 없음
- 기존 v1.8.2 기능 로직 유지
- 누락되었던 js 전체 및 assets 포함
- 표시 버전 v1.8.4

[GitHub 교체 방법]
1. 기존 Jcoupe-class-portal 저장소의 파일을 이 폴더 내용으로 전체 교체
2. 반드시 js 폴더와 assets 폴더까지 함께 업로드
3. Commit -> Push
4. GitHub Pages 배포가 끝난 뒤 학생 포털에서 Ctrl+F5
5. 상단 상태가 '연결 준비 중' -> '수업 정보 연결 중' -> '최신 정보 연결'로 바뀌는지 확인

[중요 - Drive Bridge]
js/drive-bridge-config.js의 webAppUrl은 배포 환경의 Google Apps Script /exec 주소를 사용해야 함.
이 복구 패키지에는 보안을 위해 placeholder가 들어 있으므로,
기존에 사용하던 Drive Bridge /exec 주소가 있다면 같은 값을 다시 넣어야 추가자료 PDF 업로드/열람이 정상 작동함.
이는 초기 Firebase 연결과는 별개이며, '연결 준비 중' 문제의 직접 원인은 아님.
