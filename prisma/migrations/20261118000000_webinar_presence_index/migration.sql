-- 라이브 중 "동시 시청자 수"와 대기 화면 "함께 기다리는 인원"은 둘 다 WebinarRegistration 의
-- 프레즌스 타임스탬프를 센다. 기존 인덱스는 (webinarId, submittedAt) 뿐이라 두 COUNT 가
-- 그 웨비나의 **등록자 전 행**을 훑었다. 500명 규모에서는 견디지만, 누적 등록자가 수천인
-- 웨비나(재방송·장기 모집)에서는 폴마다 수천 행 필터가 된다.
--
-- ── 왜 presencePingAt **하나만** 만드나 ───────────────────────────────────
-- 처음엔 lastPingAt 인덱스도 함께 만들었다. 그게 틀린 이유: ping 라우트가 **매 heartbeat 마다
-- 두 컬럼을 모두 UPDATE 한다.** 인덱스가 걸린 컬럼을 갱신하면 Postgres 의 HOT update 가 깨져
-- 매 갱신이 인덱스 엔트리를 새로 쓰고, WAL·인덱스 bloat·autovacuum 부담이 그만큼 늘어난다.
-- 시청자 500명이면 분당 500건의 갱신이라 그 비용이 읽기 이득보다 크다(Supabase Pro 기본
-- 컴퓨트는 Micro — baseline 11 MB/s · 500 IOPS 다).
--
-- 인덱스 하나로 충분한 근거: ping 의 네 경로(wait · enter · leave · heartbeat)가 **전부**
-- presencePingAt 을 찍는다. 그래서 "최근 5분 안에 신호를 보낸 행"에는 presencePingAt 이
-- 반드시 들어 있고, 조회 쪽의 lastPingAt OR 조건은 죽은 가지였다(그 조건도 함께 걷어냈다 —
-- lib/webinar-live-snapshot.ts).
CREATE INDEX IF NOT EXISTS "WebinarRegistration_webinarId_presencePingAt_idx"
  ON "WebinarRegistration" ("webinarId", "presencePingAt");
