// Stub for @expo-google-fonts/material-symbols (see metro.config.js).
// Covers any named export (MaterialSymbols_400Regular, useFonts, …) with a
// harmless function; only SymbolView/NativeTabs would ever call it.
module.exports = new Proxy(
  {},
  {
    get: () => () => null,
  }
);
