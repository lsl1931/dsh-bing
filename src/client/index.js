// dsh-notify-plus client half.
//
// This file is a raw CJS body. build.mjs wraps it in the factory form the DSH
// client-modules system registers (window.__ModuleLoader__.load). Do not add
// import/export statements here.
//
// Status: scaffold only. M2 adds the session watcher and toast copy; M3 adds
// the shared sound picker mounted both in Settings and in the Plugins page.

/** Client services required before apply runs. */
exports.inject = []

/**
 * Compose the client half.
 * @param {object} ctx - client cordis context.
 */
exports.apply = function apply(ctx) {
  void ctx
}
