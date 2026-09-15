# 독-토-글 수업 종합 포털 v1.2.0

관리자용 `제이쿱 수업 통합 제어 시스템 v2.2.0`에서 공개한 수업 진도와 Google Drive 수업 자료를 학생에게 보여주는 포털입니다.

## v1.2.0

- 상단 메뉴 `수업 진도 / 수업 자료실`
- 선택한 반에 맞는 자료 자동 필터
- 자료 분류 필터 및 검색
- 자료 미리 보기 / 다운로드
- 모바일 대응
- Firebase Storage 미사용

학생 포털은 `publicCourses/{projectId}/classes`와 `publicCourses/{projectId}/materials`를 읽습니다.
