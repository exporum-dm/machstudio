import { NextResponse } from "next/server";
import { getWebinarLiveSnapshot } from "@/lib/webinar-live-snapshot";

// 경량 상태 전용 엔드포인트 — 라이브 전(사전등록·입장 대기) 폴링이 /info 전체(세션·테마·config)를
// 30초마다 다시 받지 않도록, 상태 전환 판정에 필요한 값만 반환한다.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  /**
   * 값은 전부 **모든 방문자에게 같다** — 그래서 live-state 와 **같은 5초 스냅샷**에서 읽는다
   * (lib/webinar-live-snapshot). 대기 중인 500명이 30초마다 이걸 부르면 초당 17요청이고,
   * 예전에는 그때마다 웨비나 행 + COUNT 두 건을 따로 돌렸다 — 전부 같은 답이 나오는 쿼리였다.
   *
   * 라이브로 넘어가는 순간의 전환도 여기서 감지한다. 스냅샷이 5초까지 낡을 수 있으므로
   * 대기 화면의 자동 전환이 최악 30초 + 5초 걸린다 — 폴 주기 안에서 흡수되는 지연이다.
   */
  const snap = await getWebinarLiveSnapshot(slug);
  if (!snap.webinar || !snap.status) {
    return NextResponse.json({ error: "없는 웨비나예요" }, { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
  }

  return NextResponse.json(
    {
      status: snap.status.status,
      entryOpen: snap.status.entryOpen,
      canRegister: snap.status.canRegister,
      serverNow: new Date().toISOString(),
      /**
       * 지금 대기 중인 인원(5분 프레즌스)과 **누적 사전등록자 수**는 다른 값이다 —
       * 대기 화면의 "N명이 함께 기다려요" 는 등록을 망설이는 사람에게 보여 주는 숫자라
       * 지금 접속 중인 몇 명이 아니라 여태 등록한 총원이어야 설득력이 있다.
       *
       * 두 값이 같은 엔드포인트에 실리는 이유: 라이브 전 폴러는 이거 하나뿐이다(30초).
       * 새 엔드포인트를 만들면 폴러가 하나 더 생긴다 — 뷰어 폴링은 창구를 늘리지 않는다(IA §10).
       */
      waitingCount: snap.waitingCount,
      registrantCount: snap.registrantCount,
    },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET" } });
}
