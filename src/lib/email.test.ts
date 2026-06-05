// Phase 04 D-03-5 — Tests for src/lib/email.ts.
//
// Mocks the `resend` package's Resend class so no real network call fires.
// Locks:
//   - The Resend client is constructed with RESEND_API_KEY at module load.
//   - sendApprovalEmail calls resend.emails.send with the correct shape:
//     { from: RESEND_FROM, to: [input.to], subject: APPROVAL_EMAIL_SUBJECT,
//       html: <contains token>, text: <contains token> }
//   - Admin-note block renders at the TOP of both bodies when supplied,
//     and is omitted when null/empty/whitespace-only.
//   - Token appears in BOTH html and text bodies.
//   - When RESEND_API_KEY is unset at module load, returns { ok: false,
//     error: 'email_disabled' } and does NOT touch the SDK.
//   - On SDK-returned error → { ok: false, error: <message> }.
//   - On SDK throw → { ok: false, error: <message> }.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Module-level mock state. Each test resets these via clearAndConfigureMock().
type SendCall = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
};

const sendCalls: SendCall[] = [];
let sendImpl: () => Promise<unknown> = async () => ({
  data: { id: 'mock-message-id' },
  error: null,
});

vi.mock('resend', () => {
  return {
    Resend: class MockResend {
      apiKey: string;
      emails: { send: (args: SendCall) => Promise<unknown> };
      constructor(apiKey: string) {
        this.apiKey = apiKey;
        this.emails = {
          send: async (args: SendCall): Promise<unknown> => {
            sendCalls.push(args);
            return sendImpl();
          },
        };
      }
    },
  };
});

function resetMock(): void {
  sendCalls.length = 0;
  sendImpl = async () => ({ data: { id: 'mock-message-id' }, error: null });
}

const ORIGINAL_KEY = process.env['RESEND_API_KEY'];
const ORIGINAL_FROM = process.env['RESEND_FROM'];

beforeEach(() => {
  resetMock();
  // Default: simulate the key being present at module load. Individual tests
  // override this and call __reloadEmailClientForTests() to flip behavior.
  process.env['RESEND_API_KEY'] = 'test_re_key';
  process.env['RESEND_FROM'] = 'Veto <noreply@getvetoed.com>';
});

afterAll(() => {
  if (typeof ORIGINAL_KEY === 'string') process.env['RESEND_API_KEY'] = ORIGINAL_KEY;
  else delete process.env['RESEND_API_KEY'];
  if (typeof ORIGINAL_FROM === 'string') process.env['RESEND_FROM'] = ORIGINAL_FROM;
  else delete process.env['RESEND_FROM'];
});

describe('buildTextBody / buildHtmlBody', () => {
  it('puts the token verbatim into the plain-text body', async () => {
    const { buildTextBody } = await import('./email.js');
    const body = buildTextBody('pv_abcdefghij', null);
    expect(body.includes('pv_abcdefghij')).toBe(true);
  });

  it('puts the token verbatim into the HTML body (escaped)', async () => {
    const { buildHtmlBody } = await import('./email.js');
    const body = buildHtmlBody('pv_abcdefghij', null);
    expect(body.includes('pv_abcdefghij')).toBe(true);
    // Token rendered in a <code> block (monospace).
    expect(body.includes('<code')).toBe(true);
  });

  it('renders admin-note block at the TOP when non-empty', async () => {
    const { buildTextBody, buildHtmlBody } = await import('./email.js');
    const note = 'Heads up: this is a custom welcome.';
    const text = buildTextBody('pv_xxx', note);
    const html = buildHtmlBody('pv_xxx', note);

    // Note appears BEFORE the standard "You're in" intro.
    const textNoteIdx = text.indexOf(note);
    const textIntroIdx = text.indexOf("You're in.");
    expect(textNoteIdx).toBeGreaterThanOrEqual(0);
    expect(textIntroIdx).toBeGreaterThan(textNoteIdx);

    expect(html.includes('A quick note from the team')).toBe(true);
    expect(html.includes(note)).toBe(true);
  });

  it('omits admin-note block when null', async () => {
    const { buildTextBody, buildHtmlBody } = await import('./email.js');
    const text = buildTextBody('pv_xxx', null);
    const html = buildHtmlBody('pv_xxx', null);
    expect(text.includes('A quick note')).toBe(false);
    expect(html.includes('A quick note')).toBe(false);
  });

  it('omits admin-note block when whitespace-only', async () => {
    const { buildTextBody, buildHtmlBody } = await import('./email.js');
    const text = buildTextBody('pv_xxx', '   \n  ');
    const html = buildHtmlBody('pv_xxx', '   \n  ');
    expect(text.includes('A quick note')).toBe(false);
    expect(html.includes('A quick note')).toBe(false);
  });

  it('escapes HTML in the admin note', async () => {
    const { buildHtmlBody } = await import('./email.js');
    const html = buildHtmlBody('pv_xxx', '<script>alert(1)</script>');
    expect(html.includes('<script>alert(1)</script>')).toBe(false);
    expect(html.includes('&lt;script&gt;')).toBe(true);
  });

  it('includes the Claude Desktop config snippet pointing at getvetoed.com/mcp', async () => {
    const { buildTextBody, buildHtmlBody } = await import('./email.js');
    const text = buildTextBody('pv_token', null);
    const html = buildHtmlBody('pv_token', null);
    expect(text.includes('https://getvetoed.com/mcp')).toBe(true);
    expect(html.includes('https://getvetoed.com/mcp')).toBe(true);
    expect(text.includes('Bearer pv_token')).toBe(true);
    expect(html.includes('Bearer pv_token')).toBe(true);
  });
});

describe('sendApprovalEmail — happy path', () => {
  it('calls resend.emails.send with the correct shape', async () => {
    const { sendApprovalEmail, __reloadEmailClientForTests, APPROVAL_EMAIL_SUBJECT, APPROVAL_EMAIL_FROM } =
      await import('./email.js');
    __reloadEmailClientForTests();

    const result = await sendApprovalEmail({
      to: 'alice@example.com',
      token: 'pv_alicetok',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.id).toBe('mock-message-id');

    expect(sendCalls).toHaveLength(1);
    const call = sendCalls[0]!;
    expect(call.from).toBe(APPROVAL_EMAIL_FROM);
    expect(call.to).toEqual(['alice@example.com']);
    expect(call.subject).toBe(APPROVAL_EMAIL_SUBJECT);
    expect(call.html.includes('pv_alicetok')).toBe(true);
    expect(call.text.includes('pv_alicetok')).toBe(true);
    expect(call.html.length).toBeGreaterThan(0);
    expect(call.text.length).toBeGreaterThan(0);
  });

  it('passes the admin note through to both bodies', async () => {
    const { sendApprovalEmail, __reloadEmailClientForTests } = await import('./email.js');
    __reloadEmailClientForTests();

    const result = await sendApprovalEmail({
      to: 'bob@example.com',
      token: 'pv_bobtok',
      adminNote: 'Custom welcome for Bob',
    });
    expect(result.ok).toBe(true);

    const call = sendCalls[0]!;
    expect(call.html.includes('Custom welcome for Bob')).toBe(true);
    expect(call.text.includes('Custom welcome for Bob')).toBe(true);
  });
});

describe('sendApprovalEmail — failure paths', () => {
  it('returns { ok: false, error: "email_disabled" } when RESEND_API_KEY is unset', async () => {
    delete process.env['RESEND_API_KEY'];
    const { sendApprovalEmail, __reloadEmailClientForTests } = await import('./email.js');
    __reloadEmailClientForTests();

    const result = await sendApprovalEmail({ to: 'x@example.com', token: 'pv_x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('email_disabled');
    // Critically: no SDK call attempted.
    expect(sendCalls).toHaveLength(0);
  });

  it('surfaces SDK-returned error', async () => {
    const { sendApprovalEmail, __reloadEmailClientForTests } = await import('./email.js');
    __reloadEmailClientForTests();

    sendImpl = async () => ({
      data: null,
      error: { name: 'invalid_to', message: 'Recipient bounced' },
    });

    const result = await sendApprovalEmail({ to: 'y@example.com', token: 'pv_y' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Recipient bounced');
  });

  it('surfaces a thrown error', async () => {
    const { sendApprovalEmail, __reloadEmailClientForTests } = await import('./email.js');
    __reloadEmailClientForTests();

    sendImpl = async () => {
      throw new Error('network down');
    };

    const result = await sendApprovalEmail({ to: 'z@example.com', token: 'pv_z' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('network down');
  });

  it('rejects invalid `to`', async () => {
    const { sendApprovalEmail, __reloadEmailClientForTests } = await import('./email.js');
    __reloadEmailClientForTests();

    const result = await sendApprovalEmail({ to: '   ', token: 'pv_x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('invalid_to');
  });

  it('rejects empty token', async () => {
    const { sendApprovalEmail, __reloadEmailClientForTests } = await import('./email.js');
    __reloadEmailClientForTests();

    const result = await sendApprovalEmail({ to: 'x@example.com', token: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('invalid_token');
  });
});
