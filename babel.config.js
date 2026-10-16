// Babel for Metro and Jest.
//
// babel-preset-expo 54 adds `react-native-worklets/plugin` by itself whenever
// react-native-worklets is installed (Reanimated 4 moved its plugin there), and
// it must stay the LAST plugin. Listing it here as well would run it twice, so
// it is deliberately absent. `test/harness/__tests__/babel.test.ts` checks that
// a worklet still compiles through this config, so a preset upgrade that drops
// the automatic plugin fails CI instead of crashing a bottom sheet on a phone.
module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
