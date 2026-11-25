export function isCreatorPrivatePath(url: string | undefined) {
  return !!url && /(?:^|\/)(?:creator-entry|creator-portal|creators|api\/public\/creator(?:-entry)?)(?:\/|$)/.test(url);
}
