// Devvit only wires the UserActions plugin when `permissions.reddit.asUser` lists the scope, even though the config
// schema describes that field as unused. Without it, chalk marks, joining and posting a built trial all fail on Reddit
// with "UserActions plugin is not enabled" while every local check passes. This test reads the server source for the
// calls that act as the user and checks devvit.json grants each one.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(readFileSync('devvit.json', 'utf8')) as { permissions: { reddit: { asUser?: string[] } } };
const granted = new Set(config.permissions.reddit.asUser ?? []);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

const code = sources('src/server')
  .map((p) => readFileSync(p, 'utf8'))
  .join('\n');

// The call's own arguments, bounded so one call cannot borrow `runAs` from the next.
const COMMENT_AS_USER = /submitComment\([\s\S]{0,400}?runAs: 'USER'/;
const POST_AS_USER = /submitCustomPost\([\s\S]{0,400}?runAs: 'USER'/;

describe('devvit.json user-action scopes', () => {
  it('grants SUBMIT_COMMENT when a comment is posted as the user', () => {
    if (COMMENT_AS_USER.test(code)) expect(granted.has('SUBMIT_COMMENT')).toBe(true);
  });

  it('grants SUBMIT_POST when a post is submitted as the user', () => {
    if (POST_AS_USER.test(code)) expect(granted.has('SUBMIT_POST')).toBe(true);
  });

  it('grants SUBSCRIBE_TO_SUBREDDIT when the player can join from the game', () => {
    if (code.includes('subscribeToCurrentSubreddit(')) expect(granted.has('SUBSCRIBE_TO_SUBREDDIT')).toBe(true);
  });

  it('finds the calls it is guarding, so a rename does not silently pass', () => {
    expect(code).toMatch(COMMENT_AS_USER);
    expect(code).toMatch(POST_AS_USER);
    expect(code).toContain('subscribeToCurrentSubreddit(');
  });
});
