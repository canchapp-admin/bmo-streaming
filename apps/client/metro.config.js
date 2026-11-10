const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [...(config.watchFolders || []), monorepoRoot]

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
]

config.resolver.unstable_enablePackageExports = true

config.resolver.alias = {
  '@': projectRoot,
}

// UNA sola copia de cada paquete de la app en el bundle.
//
// Con el linker aislado de Bun, un mismo paquete puede quedar instalado en
// varias "variantes" (misma versión, distinto conjunto de peers): p. ej.
// `@react-native/virtualized-lists` enlazado a OTRA react-native, o
// expo-router con su propia copia de expo-image / expo-linking. El bundle
// terminaba con dos renderizadores (el FlatList fallaba con "Cannot read
// property 'default' of undefined" en findNodeHandle) o con dos copias de un
// módulo nativo de Expo.
//
// Regla: todo paquete que la app declara como dependencia directa (react,
// react-native, expo, expo-*, react-native-*…) se resuelve SIEMPRE desde la
// app, sin importar quién lo pida.
const appDeps = new Set(Object.keys(require('./package.json').dependencies ?? {}))
const packageOf = (name) => {
  const parts = name.split('/')
  return name.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}
const appOrigin = path.join(projectRoot, 'index.js')
const upstreamResolve = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolve ?? context.resolveRequest
  if (!moduleName.startsWith('.') && !moduleName.startsWith('/') && appDeps.has(packageOf(moduleName))) {
    return resolve({ ...context, originModulePath: appOrigin }, moduleName, platform)
  }
  return resolve(context, moduleName, platform)
}

module.exports = config
