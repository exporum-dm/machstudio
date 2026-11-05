-- 홍보실(PrRoom) — 조직이 직접 운영하는 채널(홈페이지·SNS·행사 플랫폼 등록글) URL 목록.
-- "언급·반응 조사"·"Claude 조사"가 이 목록에 걸리는 URL은 제외한다(우리가 직접 올린 글은
-- 제3자 반응이 아니다). 재실행 안전(IF NOT EXISTS).

BEGIN;

ALTER TABLE "PrRoom" ADD COLUMN IF NOT EXISTS "ownChannelUrls" JSONB NOT NULL DEFAULT '[]';

COMMIT;
