export function filesystemSafeTimestamp(timestamp: string): string {
  return timestamp.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '-');
}
