// @quran/core ships TypeScript source rather than a build output, so Metro
// has to watch and resolve outside this app's directory. This is the Metro
// equivalent of the web app's `transpilePackages: ['@quran/core']`.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Without this, two copies of a hoisted dependency can be resolved.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
