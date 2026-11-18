-- 등록자가 **어느 언어 폼에서** 신청했는가.
--
-- 저장되는 답변 값은 언제나 원문 어휘다(register 라우트의 toBaseLocaleAnswer) — 그래야
-- 분석·필터·CSV 가 한 갈래로 간다. 그래서 "어느 언어였나" 는 값으로 알 수 없고 별 컬럼이 필요하다.
-- 쓰는 곳: 언어별 리마인더 메일, 명단 CSV의 '작성 언어' 열(다국어 폼일 때만 붙는다).
-- 기존 행은 NULL — 그때는 폼의 기본 언어로 읽는다(언어가 하나였으므로 사실과 같다).
ALTER TABLE "WebinarRegistration" ADD COLUMN "locale" TEXT;
