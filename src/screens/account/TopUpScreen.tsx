/**
 * @deprecated The first build's top-up page is gone: Plans is the root modal
 * `Plans` (src/features/plans/PlansView.tsx, PLANS-1), opened with
 * `navigation.navigate('Plans')`. The route reaches the screen through this
 * re-export only because two of F4's shell tests stand in for this path by
 * name; QA-1 deletes the file and those mocks together.
 */
export { default } from '../../features/plans/PlansView';
