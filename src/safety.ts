export async function runDestructiveFlow<T>(steps: {
  before: () => Promise<void>;
  mutate: () => Promise<T>;
  recordCommit: (result: T) => Promise<void>;
  after: (result: T) => Promise<void>;
}): Promise<T> {
  await steps.before();
  const result = await steps.mutate();
  await steps.recordCommit(result);
  await steps.after(result);
  return result;
}
