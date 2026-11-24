// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { isCreatorPrivatePath } from "@/lib/creator/private-path";

const onPrivateCreatorPage = () => typeof window !== "undefined" && isCreatorPrivatePath(window.location.pathname);

Sentry.init({
  dsn: "https://2aba397dcbb9358aca64c9e90118a6cd@o4511448443322368.ingest.us.sentry.io/4511448444960768",

  // Add optional integrations for additional features
  integrations: onPrivateCreatorPage() ? [] : [Sentry.replayIntegration()],

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampler: ({ name }) => onPrivateCreatorPage() || isCreatorPrivatePath(name) ? 0 : 1,
  beforeSend: (event) => onPrivateCreatorPage() || isCreatorPrivatePath(event.request?.url) ? null : event,
  beforeBreadcrumb: (breadcrumb) => {
    const data = breadcrumb.data;
    return onPrivateCreatorPage() || [data?.url, data?.to, data?.from].some((url) => typeof url === "string" && isCreatorPrivatePath(url)) ? null : breadcrumb;
  },
  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Define how likely Replay events are sampled.
  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.1,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});

export const onRouterTransitionStart: typeof Sentry.captureRouterTransitionStart = (href, navigationType) => {
  if (isCreatorPrivatePath(href)) {
    void Sentry.getReplay()?.stop();
    return;
  }
  Sentry.captureRouterTransitionStart(href, navigationType);
};
