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

// UNA sola copia de react-native en el bundle.
//
// Con el linker aislado de Bun, `@react-native/virtualized-lists` (la base del
// FlatList) puede quedar enlazado a OTRA variante de react-native que la que usa
// la app: el bundle terminaba con dos renderizadores completos (~560 módulos
// cada uno) y el FlatList fallaba al renderizar con "Cannot read property
// 'default' of undefined" en findNodeHandle. Se resuelve todo `react-native`
// (y sus subrutas) desde la app, sin importar quién lo pida.
const upstreamResolve = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolve ?? context.resolveRequest
  if (moduleName === 'react-native' || moduleName.startsWith('react-native/')) {
    return resolve(
      { ...context, originModulePath: path.join(projectRoot, 'index.js') },
      moduleName,
      platform
    )
  }
  return resolve(context, moduleName, platform)
}

module.exports = config
