// Phase 03 T07 — Declaration merging for Express's Request so authRequired
// can attach the validated token's id + email without `any`-casts downstream.
//
// Imported for side effect by src/auth/middleware.ts and src/http/server.ts.

import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    tokenId?: number;
    tokenEmail?: string;
  }
}
