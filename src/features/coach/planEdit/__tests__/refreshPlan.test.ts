/**
 * After a change is applied or undone in chat, the plan is read again and
 * only then are the screens holding their own copy of the programme (the
 * overview's weeks, its Changes list) told to read it too: iOS posts
 * `.healthPlanChanged` once `health.load` is done. A failed read still tells
 * them, as iOS posts it whatever the read did.
 */
import { resetHealthStoreForTests, useHealthStore } from '../../../../health/store';
import { refreshPlan } from '../undo';

const realLoad = useHealthStore.getState().load;

afterEach(() => {
  useHealthStore.setState({ load: realLoad });
  resetHealthStoreForTests();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('refreshPlan', () => {
  it('tells the other screens once the forced read has answered, not before', async () => {
    let answer: () => void = () => undefined;
    const load = jest.fn(() => new Promise<void>((resolve) => (answer = resolve)));
    useHealthStore.setState({ load });
    const before = useHealthStore.getState().planChangedNonce;

    refreshPlan();
    await settle();
    expect(load).toHaveBeenCalledWith({ force: true });
    expect(useHealthStore.getState().planChangedNonce).toBe(before);

    answer();
    await settle();
    expect(useHealthStore.getState().planChangedNonce).toBe(before + 1);
  });

  it('a read that fails still tells them', async () => {
    useHealthStore.setState({ load: jest.fn(() => Promise.reject(new Error('offline'))) });
    const before = useHealthStore.getState().planChangedNonce;

    refreshPlan();
    await settle();
    expect(useHealthStore.getState().planChangedNonce).toBe(before + 1);
  });
});
