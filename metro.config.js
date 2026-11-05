const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// expo-router pulls in expo-symbols, and with it ~6 MB of MaterialSymbols fonts
// in 7 weights that only SymbolView/NativeTabs use, which this app does not
// (expo/expo#43614). That package resolves to a stub so Metro does not bundle
// the fonts. If NativeTabs is ever used, remove this.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@expo-google-fonts/material-symbols')) {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'src/stubs/material-symbols.js'),
    };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
