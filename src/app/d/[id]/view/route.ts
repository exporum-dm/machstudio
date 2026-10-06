/**
 * 상세페이지 단독 보기 — 아임웹에 붙이기 전에 실제 화면(폰 포함)으로 확인하고 팀원에게 공유한다.
 *
 * 임베드 로더(/d/{id})를 그대로 불러오는 빈 HTML 이다. 로더 자체가 이미 공개라 새로 열리는
 * 정보는 없다. 비공개 상태면 로더가 "아직 공개되지 않은 페이지예요" 만 그린다.
 */
import { NextResponse } from "next/server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9]{10,40}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>상세페이지 미리보기</title>
<style>html,body{margin:0;padding:0;background:#06080d}</style>
</head>
<body>
<div data-mach-page="${id}"></div>
<script async src="/d/${id}"></script>
</body>
</html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
      "X-Robots-Tag": "noindex",
    },
  });
}
