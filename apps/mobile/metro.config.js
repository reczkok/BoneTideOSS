const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('glb', 'gltf', 'bin', 'ogg');

const workspaceRoot = path.resolve(__dirname, '../..');
config.watchFolders = [workspaceRoot];
config.resolver.unstable_enableSymlinks = true;
config.resolver.nodeModulesPaths = [
  path.join(__dirname, 'node_modules'),
  path.join(workspaceRoot, 'node_modules'),
];

const prevResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('#platform/')) {
    return {
      type: 'sourceFile',
      filePath: path.join(__dirname, 'src/platform', moduleName.slice('#platform/'.length)),
    };
  }
  return (prevResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
