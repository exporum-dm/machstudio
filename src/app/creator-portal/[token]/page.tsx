import { notFound } from "next/navigation";
import { buildStkCss } from "@/lib/stk-css";
import { CreatorPortal } from "@/components/creator/CreatorPortal";
import { getPublicAppOrigin } from "@/lib/app-url";
import { loadPortal } from "@/lib/creator/portal";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function CreatorActivityPage({ params, searchParams }: {
  params: Promise<{ token: string }>; searchParams: Promise<{ preview?: string }>;
}) {
  const { token } = await params;
  const [data, query] = await Promise.all([loadPortal(token), searchParams]);
  if (!data) notFound();
  return <main className="stk-live min-h-dvh bg-[var(--card-2)] px-4 py-8 sm:py-14">
    <style>{buildStkCss("#4338ca", "#171729", "#ffffff")}</style>
    <CreatorPortal token={token} data={JSON.parse(JSON.stringify(data))} origin={getPublicAppOrigin()} preview={query.preview !== undefined} />
  </main>;
}
