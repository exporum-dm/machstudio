// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { isCreatorPrivatePath } from "./src/lib/creator/private-path";

Sentry.init({
  dsn: "https://2aba397dcbb9358aca64c9e90118a6cd@o4511448443322368.ingest.us.sentry.io/4511448444960768",

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampler: ({ name, normalizedRequest }) => isCreatorPrivatePath(normalizedRequest?.url) || isCreatorPrivatePath(name) ? 0 : 1,
  beforeSend: (event) => isCreatorPrivatePath(event.request?.url) || isCreatorPrivatePath(event.transaction) ? null : event,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});
