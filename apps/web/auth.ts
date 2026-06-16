// TEMPORARY stub — replaced by the NextAuth config in the next task.
export async function auth(): Promise<{ user?: { name?: string } } | null> {
  return null;
}
export async function signIn(_provider?: string, _opts?: unknown): Promise<void> {}
