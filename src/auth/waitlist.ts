// Phase 14 — waitlist (paid-tier interest capture, no payment). HANDOFF:
// Aljosa chose a waitlist over Stripe for v1 interest signal.

import { getDb } from '../db/connection.js';

export function addToWaitlist(input: {
  email: string;
  tier?: string | null;
  note?: string | null;
  ipHash?: string | null;
}): void {
  const email = input.email.trim();
  getDb()
    .prepare(
      `INSERT INTO waitlist (email, email_normalized, tier, note, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      email,
      email.toLowerCase(),
      input.tier?.slice(0, 80) ?? null,
      input.note?.slice(0, 1000) ?? null,
      input.ipHash ?? null,
      new Date().toISOString()
    );
}
