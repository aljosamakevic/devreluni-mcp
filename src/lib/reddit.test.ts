// T-V06 — Unit tests for the Reddit URL helpers exported from lib/reddit.ts.
//
// These helpers parse the Serper-shaped Reddit URLs we get back from Google
// SERP results (per CONCERNS.md M7). They're pure string/URL operations, so
// regressions here would silently mis-attribute posts to wrong subreddits or
// produce phantom IDs.

import { describe, it, expect } from 'vitest';
import { extractSubreddit, urlToId, urlToPermalink } from './reddit.js';

describe('extractSubreddit()', () => {
  it('extracts the subreddit from a canonical comment URL', () => {
    expect(
      extractSubreddit(
        'https://reddit.com/r/productivity/comments/abc/post-title',
      ),
    ).toBe('productivity');
  });

  it('extracts the subreddit from a www-prefixed URL (case-insensitive matcher, case-preserving capture)', () => {
    expect(extractSubreddit('https://www.reddit.com/r/ADHD/post')).toBe('ADHD');
  });

  it("returns 'unknown' for non-reddit URLs", () => {
    expect(extractSubreddit('https://example.com/not-reddit')).toBe('unknown');
  });
});

describe('urlToId()', () => {
  it('returns the last path segment of a permalink', () => {
    expect(
      urlToId('https://reddit.com/r/x/comments/abc123/title-slug'),
    ).toBe('title-slug');
  });

  it('handles trailing slashes by skipping the empty final segment', () => {
    expect(
      urlToId('https://www.reddit.com/r/productivity/comments/abc/foo_bar/'),
    ).toBe('foo_bar');
  });
});

describe('urlToPermalink()', () => {
  it('returns the path component of a valid URL', () => {
    expect(
      urlToPermalink('https://www.reddit.com/r/x/comments/abc/title'),
    ).toBe('/r/x/comments/abc/title');
  });

  it('falls through to the raw input for an unparseable URL (no throw)', () => {
    expect(urlToPermalink('not-a-url')).toBe('not-a-url');
  });
});
