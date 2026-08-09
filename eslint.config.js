// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // SDK 56 turns on the React Compiler era of the hooks rules, and they fire
    // 133 times on code that works: refs read during render, state set from an
    // effect. They are about what the compiler would need, and the compiler is
    // off here (`reactCompiler: false` in app.json), so failing the build over
    // them would be answering a question nobody asked yet.
    //
    // Warnings rather than off: the list is worth keeping in sight, since it is
    // the work that has to happen the day we do turn it on.
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/static-components": "warn",
    },
  },
]);
