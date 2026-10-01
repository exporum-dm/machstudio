/**
 * 현장 체크인 스캔 화면 — `/checkin/{token}` (운영요원용, 로그인 없음).
 *
 * 운영요원이 자기 휴대폰으로 연다. 링크 + 4자리 PIN 을 통과하면 카메라로 방문자 QR(등록번호)을
 * 찍어 입장을 기록한다. 같은 화면에서 번호 직접 입력과 USB/블루투스 바코드 스캐너 입력도 받는다.
 *
 * 링크가 없거나 꺼진 소스는 notFound — 토큰 존재 여부를 떠볼 수 없게 같은 404 다.
 */
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { loadCheckinSource } from "@/lib/collect-checkin-server";
import { CheckinScanner } from "./CheckinScanner";

export const dynamic = "force-dynamic";

/** 남의 체크인 링크가 검색에 뜨면 안 된다. */
export const metadata: Metadata = { title: "현장 체크인", robots: { index: false, follow: false } };

export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, themeColor: "#0a0a0a" };

export default async function CheckinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const source = await loadCheckinSource(token);
  if (!source) notFound();
  return <CheckinScanner token={token} sourceName={source.name} timezone={source.checkinTimezone} />;
}
