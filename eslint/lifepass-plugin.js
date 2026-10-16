// LifePass's own lint rules (see eslint.config.js for where each applies).
//
//   lifepass/no-literal-copy     member-facing words must come from t()/tp()
//   lifepass/feature-boundaries  a feature reaches another only through its
//                                index or a published slot (plan 3.0.3)
//
// `react-native/no-raw-text` (eslint-plugin-react-native) only catches text
// OUTSIDE a <Text>, which crashes on React Native; it says nothing about
// `<Text>Book now</Text>`. The parity build's rule is stronger: every word a
// member reads comes from the generated iOS tables or an Android pack, never
// a literal (BUILD_RULES, "All member-facing text through t()"). That is
// what no-literal-copy checks.
const fs = require('fs');
const path = require('path');

/** Has at least one letter in any script (Latin, Icelandic, ...). */
const HAS_LETTER = /\p{L}/u;

/** JSX props a member reads or hears (TalkBack). */
const COPY_PROPS = new Set([
  'accessibilityLabel',
  'accessibilityHint',
  'aria-label',
  'placeholder',
  'title',
  'label',
  'headerTitle',
  'tabBarLabel',
  'tabBarAccessibilityLabel',
  'headerBackTitle',
]);

/**
 * Object keys whose string value a member reads or hears, wherever the object
 * goes: navigation options (`{ title }`), notification content
 * (`{ content: { title, body, subtitle } }`), `Share.share({ message })`, tab
 * and menu tables (`{ label: 'Home' }`), banners and empty states
 * (`{ text, hint, cta }`). A key that is not copy in some file (an internal
 * error `message`, say) takes an inline disable with the reason.
 */
const COPY_OBJECT_KEYS = new Set([
  'title',
  'subtitle',
  'body',
  'message',
  'text',
  'label',
  'hint',
  'placeholder',
  'cta',
  'headerTitle',
  'tabBarLabel',
  'tabBarAccessibilityLabel',
  'headerBackTitle',
  'accessibilityLabel',
  'accessibilityHint',
]);

/**
 * State setters whose string argument ends up on screen (`setError('Could not
 * update favourites')`, `setErrorMessage(...)`, `setToastText(...)`).
 */
const COPY_SETTER = /^set(?:[A-Z]\w*)?(?:Error|Message|Notice|Toast|Banner|Hint)(?:Text)?$/;

/** Calls whose string arguments are shown to the member. */
const COPY_CALLS = new Set([
  'Alert.alert',
  'Alert.prompt',
  'ToastAndroid.show',
  'ToastAndroid.showWithGravity',
  'ToastAndroid.showWithGravityAndOffset',
  'Share.share',
]);

function isCopy(value, allowed) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text || !HAS_LETTER.test(text)) return false;
  return !allowed.has(text);
}

function calleeName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    const object = calleeName(node.object);
    return object ? `${object}.${node.property.name}` : null;
  }
  return null;
}

const noLiteralCopy = {
  meta: {
    type: 'problem',
    docs: { description: 'Member-facing text must come from t() / tp(), never a literal.' },
    schema: [
      {
        type: 'object',
        properties: { allow: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: {
      literal:
        'Member-facing text "{{text}}" is a literal. Use t()/tp() with the generated iOS key, ' +
        "or add Android-only copy to this package's pack in src/i18n/android/.",
    },
  },
  create(context) {
    const allowed = new Set(['LifePass', ...((context.options[0] && context.options[0].allow) || [])]);
    const report = (node, text) =>
      context.report({ node, messageId: 'literal', data: { text: String(text).trim().slice(0, 40) } });
    const checkExpression = (node) => {
      if (!node) return;
      if (node.type === 'Literal' && isCopy(node.value, allowed)) report(node, node.value);
      if (node.type === 'TemplateLiteral') {
        const raw = node.quasis.map((q) => q.value.cooked ?? '').join(' ');
        if (isCopy(raw, allowed)) report(node, raw);
      }
      if (node.type === 'ConditionalExpression') {
        checkExpression(node.consequent);
        checkExpression(node.alternate);
      }
      if (node.type === 'LogicalExpression') checkExpression(node.right);
    };
    return {
      JSXText(node) {
        if (isCopy(node.value, allowed)) report(node, node.value);
      },
      JSXExpressionContainer(node) {
        if (node.parent && node.parent.type === 'JSXAttribute') return;
        checkExpression(node.expression);
      },
      JSXAttribute(node) {
        const name = node.name.type === 'JSXIdentifier' ? node.name.name : null;
        if (!name || !COPY_PROPS.has(name) || !node.value) return;
        if (node.value.type === 'Literal') checkExpression(node.value);
        if (node.value.type === 'JSXExpressionContainer') checkExpression(node.value.expression);
      },
      Property(node) {
        if (node.computed || node.kind !== 'init') return;
        const key = node.key.type === 'Identifier' ? node.key.name : node.key.value;
        if (COPY_OBJECT_KEYS.has(key)) checkExpression(node.value);
      },
      CallExpression(node) {
        const name = calleeName(node.callee);
        if (!name || !(COPY_CALLS.has(name) || COPY_SETTER.test(name))) return;
        node.arguments.forEach(checkExpression);
      },
    };
  },
};

// --- feature-boundaries -----------------------------------------------------

/**
 * Cross-feature mount points that are files rather than an index (plan
 * 3.0.3). Same-feature imports are never restricted; an `index` file (or a
 * folder, which resolves to its index) is always public.
 */
const PUBLISHED_SLOTS = new Set([
  'meals/ScanMealEntry',
  'classes/ClassesDiscovery',
  'attractions/SightsSearchGroup',
  'attractions/map/SightsLayer',
  'attractions/HomeOutsideCard',
  'plan/HomeTodayRow',
  'plan/proposal/ProgramProposalCard',
  'explore/map/ExploreMap',
  'auth/SocialSignInButtons',
  'auth/authCallback',
  'checkin/proof/CheckInProofDisplay',
]);

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

function stripExtension(file) {
  const ext = SOURCE_EXTENSIONS.find((e) => file.endsWith(e));
  return ext ? file.slice(0, -ext.length) : file;
}

function featureOf(relativeToFeatures) {
  const [feature, ...rest] = relativeToFeatures.split('/');
  return { feature, rest: rest.join('/') };
}

const featureBoundaries = {
  meta: {
    type: 'problem',
    docs: { description: "A feature imports another feature only through its index or a published slot." },
    schema: [
      {
        type: 'object',
        properties: {
          root: { type: 'string' },
          slots: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      internal:
        '"{{source}}" reaches into feature "{{target}}". Import it through src/features/{{target}}/index.ts ' +
        'or a published slot (plan 3.0.3); ask its owner for a contract if neither covers it.',
    },
  },
  create(context) {
    const options = context.options[0] || {};
    const root = options.root || context.cwd || process.cwd();
    const featuresDir = path.join(root, 'src', 'features');
    const slots = new Set([...PUBLISHED_SLOTS, ...(options.slots || [])]);
    const filename = context.filename || context.getFilename();
    const fromRelative = path.relative(featuresDir, filename).split(path.sep).join('/');
    if (fromRelative.startsWith('..')) return {};
    const from = featureOf(fromRelative).feature;

    const check = (node, source) => {
      if (typeof source !== 'string' || !source.startsWith('.')) return;
      const absolute = path.resolve(path.dirname(filename), source);
      const relative = path.relative(featuresDir, absolute).split(path.sep).join('/');
      if (relative.startsWith('..') || relative === '') return;
      const { feature, rest } = featureOf(stripExtension(relative));
      if (feature === from) return;
      if (rest === '' || rest === 'index' || rest.endsWith('/index')) return;
      if (slots.has(`${feature}/${rest}`)) return;
      let isDirectory = false;
      try {
        isDirectory = fs.statSync(absolute).isDirectory();
      } catch {
        isDirectory = false;
      }
      if (isDirectory) return;
      context.report({ node, messageId: 'internal', data: { source, target: feature } });
    };

    return {
      ImportDeclaration(node) {
        check(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) check(node, node.source.value);
      },
      ExportAllDeclaration(node) {
        check(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal') check(node, node.source.value);
      },
      CallExpression(node) {
        const name = calleeName(node.callee);
        if ((name === 'require' || name === 'jest.mock') && node.arguments[0] && node.arguments[0].type === 'Literal') {
          check(node, node.arguments[0].value);
        }
      },
    };
  },
};

module.exports = {
  meta: { name: 'eslint-plugin-lifepass', version: '1.0.0' },
  rules: {
    'no-literal-copy': noLiteralCopy,
    'feature-boundaries': featureBoundaries,
  },
  PUBLISHED_SLOTS,
};
