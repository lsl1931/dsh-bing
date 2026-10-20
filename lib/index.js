// dsh-pulse host half.
//
// Status: scaffold only. The working design lives in PLAN.md; this entry is
// deliberately a no-op so the repository builds and can be linked into a
// profile without changing behaviour until M1 lands.
//
// M1 adds, in this order:
//   1. the pulse session projection (fold turn/end + pending asks);
//   2. the same-origin routes in src/shared/protocol.js;
//   3. the Windows toast + SoundPlayer pipeline.

/** Cordis plugin name (the Loader entry and the client bundle id). */
export const name = 'dsh-pulse'

/** The projection registry is required before the fold can register. */
export const inject = ['sessionProjections']

/**
 * Register the plugin's host effects.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host cordis context.
 */
export function apply(ctx) {
  void ctx
}
