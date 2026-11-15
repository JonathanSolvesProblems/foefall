// Stand-in for @devvit/web/client in the local preview. Expanded mode becomes a page change.
export const context = { postId: 't3_local', subredditName: 'forewarned_dev', username: 'local', userId: 't2_local' };

export function requestExpandedMode(_e: MouseEvent, entry: string): void {
  location.href = `${entry}.html${location.search}`;
}

export function showToast(text: string): void {
  console.log('[toast]', text);
}

export function navigateTo(url: string): void {
  console.log('[navigate]', url);
}
