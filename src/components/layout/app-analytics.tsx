"use client";

import { Analytics } from "@vercel/analytics/next";
import { isCreatorPrivatePath } from "@/lib/creator/private-path";

export function AppAnalytics() {
  return <Analytics beforeSend={(event) => isCreatorPrivatePath(event.url) ? null : event} />;
}
