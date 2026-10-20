// Build dsh-bing with no dependencies.
//
// - lib/index.js + lib/shared/*.js : the Node half, copied verbatim.
// - lib/client.js : the browser half, with its local CJS modules bundled into
//   one window.__ModuleLoader__.load() factory. External requires (react) still
//   go to the shell's require.
import { mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const libDir = join(root, 'lib')
mkdirSync(join(libDir, 'shared'), { recursive: true })

copyFileSync(join(root, 'src', 'index.js'), join(libDir, 'index.js'))
for (const file of readdirSync(join(root, 'src', 'shared'))) {
  if (file.endsWith('.js')) copyFileSync(join(root, 'src', 'shared', file), join(libDir, 'shared', file))
}
console.log('lib/index.js and lib/shared written')

const clientDir = join(root, 'src', 'client')
const modules = readdirSync(clientDir)
  .filter(file => file.endsWith('.js') || file.endsWith('.cjs'))
  .sort()

const factories = modules.map(file => {
  const source = readFileSync(join(clientDir, file), 'utf8')
  return [
    '\t__modules[' + JSON.stringify('./' + file) + '] = function (module, exports, require) {',
    source,
    '\t};',
  ].join('\n')
})

const wrapped = [
  'window.__ModuleLoader__.load({',
  '\tid: "dsh-bing",',
  '\tfactory: (require) => {',
  '\t\tvar __modules = {};',
  '\t\tvar __cache = {};',
  '\t\tfunction __localRequire(id) {',
  '\t\t\tif (__cache[id]) return __cache[id].exports;',
  '\t\t\tvar factory = __modules[id];',
  '\t\t\tif (!factory) throw new Error("dsh-bing: local module not found: " + id);',
  '\t\t\tvar module = { exports: {} };',
  '\t\t\t__cache[id] = module;',
  '\t\t\tfactory(module, module.exports, function (name) {',
  '\t\t\t\treturn name.charAt(0) === "." ? __localRequire(name) : require(name);',
  '\t\t\t});',
  '\t\t\treturn module.exports;',
  '\t\t}',
  ...factories,
  '\t\treturn __localRequire("./index.js");',
  '\t}',
  '});',
  '',
].join('\n')
writeFileSync(join(libDir, 'client.js'), wrapped)
console.log('lib/client.js written (' + String(modules.length) + ' modules)')
