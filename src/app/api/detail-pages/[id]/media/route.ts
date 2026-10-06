// 상세페이지 히어로·섹션 배경 업로드(이미지·동영상).
// 대회 공고 notice-media 와 같은 규약 — 버킷 설정과 형식 검증은
// webinar-asset-bucket / webinar-landing-media 한 곳이 소유한다.
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { downscaleUpload, extensionForContentType } from "@/lib/image-downscale";
import { getDetailPageAccess } from "@/lib/detail-page/access";
import { ASSET_BUCKET, ensureAssetBucket } from "@/lib/webinar-asset-bucket";
import {
  landingMediaExtension,
  landingMediaKind,
  validateLandingMedia,
} from "@/lib/webinar-landing-media";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await getDetailPageAccess(id);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { page } = access;

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "파일을 선택해주세요." }, { status: 400 });

  const validationError = validateLandingMedia(file);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  const extension = landingMediaExtension(file.type);
  const kind = landingMediaKind(file.type);
  if (!extension || !kind) return NextResponse.json({ error: "지원하지 않는 형식이에요." }, { status: 400 });

  try {
    const admin = await ensureAssetBucket();
    // 저장 전에 줄인다 — 이유는 image-downscale.ts 주석(이미지 변환 유료·egress 쿼터).
    const downscaled = await downscaleUpload(file);
    const storedExt = extensionForContentType(downscaled.contentType, extension);
    const path = `${page.workspaceId}/detail-pages/${page.id}/${randomUUID()}.${storedExt}`;
    const { error } = await admin.storage.from(ASSET_BUCKET).upload(path, downscaled.body, {
      contentType: downscaled.contentType,
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) throw error;

    const { data } = admin.storage.from(ASSET_BUCKET).getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl, type: kind }, { status: 201 });
  } catch (error) {
    console.error("[detail-page] media upload failed", error);
    return NextResponse.json({ error: "업로드에 실패했어요. 잠시 후 다시 시도해주세요." }, { status: 500 });
  }
}
