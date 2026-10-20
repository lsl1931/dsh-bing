// Parse-compatible schemas for the one session projection this plugin owns.
//
// The projection registry only ever calls stateSchema.parse(value) and
// wire.viewSchema.parse(value) (verified in dsh-session-projection 0.2.1-rc.2).
// It never reaches into zod, so a 40-line validator avoids a 200 KB dependency
// in the host bundle.

function fail(message) {
  throw new Error('schema: ' + message)
}

/**
 * Build an object schema that accepts the exact declared keys.
 * @param {Record<string, {parse: (value: unknown) => unknown}>} shape - key schemas.
 * @returns {{parse: (value: unknown) => Record<string, unknown>}}
 */
export function object(shape) {
  const keys = Object.keys(shape)
  return {
    parse(value) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('expected object')
      const out = {}
      for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) fail('missing ' + key)
        out[key] = shape[key].parse(value[key])
      }
      return out
    },
  }
}

/** A string schema. */
export const string = {
  parse(value) {
    if (typeof value !== 'string') fail('expected string')
    return value
  },
}

/** A finite number schema. */
export const number = {
  parse(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('expected number')
    return value
  },
}

/** A non-negative integer schema. */
export const nonNegativeInt = {
  parse(value) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail('expected non-negative integer')
    return value
  },
}

/** A boolean schema. */
export const boolean = {
  parse(value) {
    if (typeof value !== 'boolean') fail('expected boolean')
    return value
  },
}

/**
 * An array schema.
 * @param {{parse: (value: unknown) => unknown}} item - the element schema.
 */
export function array(item) {
  return {
    parse(value) {
      if (!Array.isArray(value)) fail('expected array')
      return value.map(entry => item.parse(entry))
    },
  }
}

/**
 * A nullable schema.
 * @param {{parse: (value: unknown) => unknown}} inner - the non-null schema.
 */
export function nullable(inner) {
  return {
    parse(value) {
      return value === null ? null : inner.parse(value)
    },
  }
}

/**
 * One of a fixed set of strings.
 * @param {...string} values - allowed values.
 */
export function enumOf(...values) {
  const allowed = new Set(values)
  return {
    parse(value) {
      if (typeof value !== 'string' || !allowed.has(value)) fail('expected one of ' + values.join(', '))
      return value
    },
  }
}
