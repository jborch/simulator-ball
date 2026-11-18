import type { Tag } from './types';

export const emptyTag = (): Tag => ({ srId: null, status: 'empty', done: [], reason: null, retests: 0 });

export function copyTag(t: Tag): Tag {
  return { srId: t.srId, status: t.status, done: [...t.done], reason: t.reason, retests: t.retests };
}
