// Health Connect (stub; owner: HC-1).
//
// OWNER DECISION (16 Oct 2026): no Health Connect for now. This fragment adds
// nothing, `react-native-health-connect` is not a dependency, and no
// android.permission.health.* permission may reach the manifest (Play reviews
// a Health Connect declaration for every permission listed). `test/config`
// asserts all three.
module.exports = function healthConnect(config) {
  return config;
};
