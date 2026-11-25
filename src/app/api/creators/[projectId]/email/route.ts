import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { emailConfigured, sendEmailBatch } from "@/lib/email";
import { rateLimitAsync } from "@/lib/ratelimit";
import { getPublicAppOrigin } from "@/lib/app-url";
import { CreatorError, errorResponse, getCreatorProject } from "@/lib/creator/server";
import { creatorEmailHtml, recipientEmail } from "@/lib/creator/mail";

const bodySchema = z.object({
  subject: z.string().trim().min(1, "제목을 입력해 주세요.").max(150),
  message: z.string().trim().min(1, "내용을 입력해 주세요.").max(4000),
  audience: z.enum(["all", "confirmed", "unconfirmed", "selected"]),
  participantIds: z.array(z.string()).max(500).optional(),
  includePortalLink: z.boolean(),
  buttonLabel: z.string().trim().max(40).optional(),
  preview: z.boolean().optional(),
});

// 선발 크리에이터 안내 메일 — 밖으로 나가는 대량 발송이라 명단 내보내기와 같은 등급으로 관리자 이상만.
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const auth = await getCreatorProject((await params).projectId);
    if (auth.role === "MEMBER") throw new CreatorError("안내 메일 발송 권한이 없어요. 관리자에게 문의하세요.", 403);

    const input = bodySchema.safeParse(await request.json());
    if (!input.success) throw new CreatorError(input.error.issues[0]?.message ?? "입력값을 확인해 주세요.");
    const { subject, message, audience, participantIds, includePortalLink, buttonLabel, preview } = input.data;

    const program = await prisma.creatorProgram.findUnique({
      where: { projectId: auth.project.id },
      select: { id: true, name: true },
    });
    if (!program) throw new CreatorError("크리에이터 프로그램이 없어요.", 404);

    const people = await prisma.creatorParticipant.findMany({
      where: {
        programId: program.id,
        withdrawnAt: null,
        ...(audience === "confirmed" ? { confirmed: true } : audience === "unconfirmed" ? { confirmed: false } : {}),
        ...(audience === "selected" ? { id: { in: participantIds ?? [] } } : {}),
      },
      select: { id: true, name: true, token: true, contact: true, application: { select: { emailNormalized: true } } },
      orderBy: { name: "asc" },
    });

    const origin = getPublicAppOrigin();
    const targets = people.map((person) => ({
      id: person.id,
      name: person.name,
      email: recipientEmail(person.contact, person.application?.emailNormalized ?? null),
      portalUrl: includePortalLink && origin ? origin + "/creator-portal/" + person.token : "",
    }));
    const sendable = targets.filter((target) => target.email);
    const missing = targets.filter((target) => !target.email).map((target) => target.name);

    // 미리보기 — 누구에게 갈지와 첫 통 내용을 보여 주고 끝낸다. 아무것도 보내지 않는다.
    if (preview) {
      return NextResponse.json({
        preview: true, total: targets.length, sendable: sendable.length, missing,
        emailConfigured: emailConfigured(),
        portalMissing: includePortalLink && !origin,
        sample: sendable[0]
          ? { to: sendable[0].email, subject, html: creatorEmailHtml({ subject, body: message, name: sendable[0].name, portalUrl: sendable[0].portalUrl, buttonLabel }) }
          : null,
      });
    }

    if (!sendable.length) throw new CreatorError("보낼 수 있는 이메일 주소가 없어요. 선발자 탭에서 연락처를 채워 주세요.");
    // 개인 페이지 링크를 넣기로 했는데 주소를 만들 수 없으면 버튼 없는 메일이 조용히 나간다 — 막는다.
    if (includePortalLink && !origin) throw new CreatorError("공개 주소가 설정되지 않아 개인 페이지 링크를 넣을 수 없어요.");

    if (!emailConfigured()) {
      return NextResponse.json({ total: targets.length, sent: 0, skipped: sendable.length, failed: 0, missing, emailConfigured: false });
    }
    // 두 번 누르는 사고 방지 — 프로그램당 60초에 한 번.
    if (!(await rateLimitAsync(`creator-email:${program.id}`, { limit: 1, windowMs: 60_000 })).allowed) {
      throw new CreatorError("방금 발송했어요. 60초 후 다시 시도할 수 있어요.", 429);
    }

    const result = await sendEmailBatch(sendable.map((target) => ({
      to: target.email,
      subject,
      html: creatorEmailHtml({ subject, body: message, name: target.name, portalUrl: target.portalUrl, buttonLabel }),
    })));

    if (result.sent) {
      await prisma.creatorParticipant.updateMany({
        where: { id: { in: sendable.map((target) => target.id) } },
        data: { lastEmailedAt: new Date() },
      });
    }

    await logActivity({
      workspaceId: auth.project.workspaceId,
      userId: auth.userId,
      action: "creator.email_sent",
      meta: { projectId: auth.project.id, programId: program.id, audience, subject, total: targets.length, ...result, missing: missing.length },
    });

    return NextResponse.json({ total: targets.length, ...result, missing, emailConfigured: true });
  } catch (error) {
    return errorResponse(error);
  }
}
