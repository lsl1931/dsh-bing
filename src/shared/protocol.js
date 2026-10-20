// The wire vocabulary both halves of dsh-pulse must agree on.
//
// This file is the host half's copy. The browser bundle is a raw CJS body
// wrapped by build.mjs and cannot import an ESM module, so the few constants
// it needs are duplicated in src/client/protocol.js. Keep the two in sync;
// the selftest compares them.
//
// Every route lives under one prefix and is registered with kind 'exact'.
// None of them sit under /api, so none pass the host's API gateway: each
// handler therefore checks its own method and the same-origin header.

/** Route prefix owned by this plugin. */
export const ROUTE_PREFIX = '/dsh-pulse'

/** Same-origin header; keeps drive-by requests from other pages out. */
export const FOCUS_HEADER = 'x-dsh-pulse'

/** The session projection key this plugin owns (distinct from 'notify'). */
export const PROJECTION_KEY = 'pulse'

/** Every route, in one frozen table. */
export const ROUTES = Object.freeze({
  /** POST: raise one Windows toast. */
  toast: ROUTE_PREFIX + '/toast',
  /** POST: play one sound without raising a toast (settings preview). */
  preview: ROUTE_PREFIX + '/preview',
  /** POST: raise the DSH window through the app's own dsh://open handler. */
  focus: ROUTE_PREFIX + '/focus',
  /** POST: stop every sound that is still playing. */
  silence: ROUTE_PREFIX + '/silence',
  /** GET: is this app's window the OS foreground window? */
  foreground: ROUTE_PREFIX + '/foreground',
  /** GET: the built-in and custom sound libraries. */
  library: ROUTE_PREFIX + '/sound-library',
  /** POST: copy one picked audio file into the custom folder. */
  importSound: ROUTE_PREFIX + '/import-sound',
  /** POST: delete one imported custom sound. */
  deleteSound: ROUTE_PREFIX + '/delete-sound',
  /** GET/POST: report or clear the transcode cache. */
  cache: ROUTE_PREFIX + '/sound-cache',
  /** POST: open the Windows file picker. */
  pickFile: ROUTE_PREFIX + '/pick-file',
  /** GET: service-level questions observed by the host. */
  questions: ROUTE_PREFIX + '/questions',
  /** POST: one diagnostics line from the client. */
  report: ROUTE_PREFIX + '/report',
  /** GET: diagnostics JSON. */
  debug: ROUTE_PREFIX + '/debug',
})

/** How many client report lines the host keeps. */
export const REPORT_LIMIT = 40

/** How many service-level questions the host queues. */
export const QUESTION_LIMIT = 20

/** A file sound never plays longer than this, in milliseconds. */
export const SOUND_CAP_MS = 8000

/** How long one foreground answer is reused, in milliseconds. */
export const FOREGROUND_TTL_MS = 1500
