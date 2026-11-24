export function isCreatorPrivatePath(url: string | undefined) {
  return !!url && /(?:^|\/)(?:creator-portal|creators|api\/public\/creator)(?:\/|$)/.test(url);
}
