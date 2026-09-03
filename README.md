# Jcoupe Class Portal v1.0

학생용 저장소: `Jcoupe-class-portal`

현재 표시 명칭: **독-토-글 수업 종합 포털**

## v1.0 기능
- A/B/C/E반 선택
- 현재 진도
- 최근 수업일
- 수업 유형
- 실제 진행 내용
- 다음 수업 시작점
- 최근 공개 수업 기록
- Firebase 실시간 반영
- 모바일 대응

## 공개 데이터 구조
학생 포털은 관리자 데이터 `users/{uid}/...`를 직접 읽지 않습니다.

다음 공개 전용 경로만 읽습니다.

```text
publicCourses
 └─ 2026-2-G2-DOKTOGUL
     ├─ portalTitle
     ├─ portalSubtitle
     ├─ classes
     ├─ updatedAt
     └─ classes
         ├─ A
         ├─ B
         ├─ C
         └─ E
```

교사용 메모(memo)는 공개 데이터에 포함하지 않습니다.

## 현재 단계
포털 화면 자체는 배포할 수 있지만, 현재 Firebase Rules가 `publicCourses` 읽기를 막고 있고
관리자 시스템에도 공개 발행 기능이 아직 없습니다.

다음 단계:
1. 제이쿱 수업 통합 제어 시스템 v2.1에 학생 포털 발행 기능 추가
2. 공개용 Firestore 규칙 적용
3. 포털에서 실제 A/B/C/E반 진도 확인
