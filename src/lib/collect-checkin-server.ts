/**
 * 현장 체크인 서버 공통 — 토큰으로 소스를 찾고, 운영요원 세션을 확인한다.
 *
 * 공개 경로(/checkin, /api/checkin)라 로그인이 없다. 대신
 *  · 토큰: 소스마다 추측 불가한 값(재발급 가능)
 *  · PIN: 4자리, 해시만 저장, 시도 횟수 제한
 *  · 꺼져 있거나 지운 소스, 빌더형이 아닌 소스는 **없는 것처럼** 404 — 토큰 존재 여부를 떠볼 수 없게
 */
import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { checkinCookieName, verifyCheckinSession } from "@/lib/collect-checkin-session";

export const checkinSourceSelect = {
  id: true,
  name: true,
  mode: true,
  deletedAt: true,
  formConfig: true,
  checkinEnabled: true,
  checkinToken: true,
  checkinPinHash: true,
  checkinTimezone: true,
} as const;

export async function loadCheckinSource(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const source = await prisma.collectSource.findUnique({ where: { checkinToken: token }, select: checkinSourceSelect });
  if (!source || source.deletedAt || source.mode !== "builder" || !source.checkinEnabled) return null;
  return source;
}

export async function hasCheckinSession(token: string, pinHash: string | null): Promise<boolean> {
  const jar = await cookies();
  return verifyCheckinSession(jar.get(checkinCookieName(token))?.value, token, pinHash);
}
