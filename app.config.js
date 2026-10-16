// Dynamic Expo config, layered on the static app.json.
//
// Expo loads app.json first and hands its `expo` object to this function as
// `config`. Every native concern that needs a config plugin lives in its own
// fragment under config/fragments/, each owned by one package (see the parity
// plan, 3.0 rule 6), so packages never edit this file or app.json:
//
//   mapbox, notifications, background, buildProperties   F0 (notifications passes to F7)
//   camera                                                CHECKIN-1
//   imagePicker                                           MEAL-3
//   speech                                                COACH-1
//   healthConnect                                         HC-1 (owner decision: none for now)
//
// Secrets never live here: the Mapbox download token is read from the
// environment by the mapbox fragment (an EAS environment variable on EAS,
// a git-ignored .env locally).

const FRAGMENTS = [
  'mapbox',
  'notifications',
  'camera',
  'imagePicker',
  'background',
  'buildProperties',
  'speech',
  'healthConnect',
];

/** A plugin's name, whether listed as 'name' or ['name', options]. */
function pluginName(entry) {
  return Array.isArray(entry) ? entry[0] : entry;
}

/** Two fragments (or a fragment and app.json) registering one plugin is a merge mistake. */
function assertUniquePlugins(config) {
  const seen = new Set();
  for (const entry of config.plugins ?? []) {
    const name = pluginName(entry);
    if (seen.has(name)) throw new Error(`app.config.js: plugin "${name}" is registered twice`);
    seen.add(name);
  }
}

module.exports = ({ config }) => {
  const composed = FRAGMENTS.reduce(
    (current, name) => require(`./config/fragments/${name}`)(current),
    config,
  );
  assertUniquePlugins(composed);
  return composed;
};

module.exports.FRAGMENTS = FRAGMENTS;
