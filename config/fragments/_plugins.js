// Shared helpers for the fragments.

/**
 * Adds one config plugin entry. A fragment never edits another fragment's
 * plugin; if two fragments name the same plugin, app.config.js refuses to
 * build (`assertUniquePlugins`).
 */
function withPlugin(config, plugin) {
  return { ...config, plugins: [...(config.plugins ?? []), plugin] };
}

/**
 * Wraps a third-party config plugin so it cannot leave an `ios` block behind.
 *
 * This repo builds Android only. app.json carries no `ios` block on purpose:
 * the old one held the native iOS app's bundle id (`is.lifepass.ios`), and an
 * `eas build -p ios` from here would have targeted that app. Some plugins
 * write iOS Info.plist strings into `config.ios` as a side effect; this keeps
 * the evaluated config free of it, so `npx expo config` shows no `ios` at all.
 */
function androidOnly(plugin, name) {
  const wrapped = (config, props) => {
    const hadIos = Object.prototype.hasOwnProperty.call(config, 'ios');
    const result = plugin(config, props);
    if (!hadIos) delete result.ios;
    return result;
  };
  Object.defineProperty(wrapped, 'name', { value: `androidOnly(${name})` });
  return wrapped;
}

module.exports = { withPlugin, androidOnly };
