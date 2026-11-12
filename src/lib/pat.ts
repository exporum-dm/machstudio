import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

// mach Personal Access Token 포맷: xfp_<32바이트 base64url>
// 기존 토큰 prefix 호환을 위해 xfp_ 는 유지합니다.
// 평문 토큰은 발급 직후 한 번만 표시되고, DB 에는 SHA-256 해시만 저장.

export function generateToken(): { token: string; tokenHash: string; prefix: string } {
  const raw = randomBytes(32).toString("base64url");
  const token = `xfp_${raw}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const prefix = token.slice(0, 12); // xfp_xxxxxx 정도
  return { token, tokenHash, prefix };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function verifyPat(token: string): Promise<{ workspaceId: string; userId: string; scopes: string[]; tokenId: string } | null> {
  if (!token || !token.startsWith("xfp_")) return null;
  const tokenHash = hashToken(token);
  const record = await prisma.apiToken.findUnique({ where: { tokenHash } });
  if (!record) return null;
  if (record.expiresAt && record.expiresAt < new Date()) return null;
  // 사용 시각 업데이트 (비동기 fire-and-forget)
  prisma.apiToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return {
    workspaceId: record.workspaceId,
    userId: record.userId,
    scopes: record.scopes,
    tokenId: record.id,
  };
}

export const SCOPES = [
  { id: "records:read",    label: "수집 레코드 조회" },
  { id: "records:write",   label: "수집 레코드 추가/삭제" },
  { id: "sources:read",    label: "수집 소스 조회" },
  { id: "sources:write",   label: "수집 소스 관리" },
  { id: "dashboards:read", label: "대시보드 조회" },
  { id: "ads:read",        label: "광고 성과 조회" },
  { id: "content:read",    label: "콘텐츠 캘린더 조회" },
  { id: "content:write",   label: "콘텐츠 캘린더 추가/수정" },
] as const;
