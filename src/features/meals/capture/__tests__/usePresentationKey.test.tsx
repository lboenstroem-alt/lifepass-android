/**
 * The sheets' fresh form per opening (QuickAddSheet, CreateFoodSheet,
 * PresetMealSheet): a new form each time `visible` turns true, and never a
 * frame of the previous, cancelled form shown again.
 */
import { act, render } from '@testing-library/react-native';
import { useEffect, useState } from 'react';

import { usePresentationKey } from '../usePresentationKey';

/** Each committed render of a form: which form, and whether it was shown. */
let commits: { form: number; visible: boolean }[] = [];
let forms = 0;

function Form({ visible }: { readonly visible: boolean }) {
  const [form] = useState(() => ++forms);
  useEffect(() => {
    commits.push({ form, visible });
  });
  return null;
}

function Sheet({ visible }: { readonly visible: boolean }) {
  const key = usePresentationKey(visible);
  return <Form key={key} visible={visible} />;
}

beforeEach(() => {
  commits = [];
  forms = 0;
});

it('a new form for each opening, and the previous form is never shown again', async () => {
  const screen = await render(<Sheet visible={false} />);
  await act(async () => screen.rerender(<Sheet visible />));
  await act(async () => screen.rerender(<Sheet visible={false} />));
  await act(async () => screen.rerender(<Sheet visible />));

  const shown = commits.filter((entry) => entry.visible).map((entry) => entry.form);
  // Two openings, two forms; each shown form was new when it was shown.
  expect([...new Set(shown)]).toEqual([2, 3]);
  // A form first committed hidden (the one before an opening) is never
  // committed shown: an effect-driven key would show it for a frame.
  const firstCommits = new Map<number, boolean>();
  for (const { form, visible } of commits) if (!firstCommits.has(form)) firstCommits.set(form, visible);
  for (const [form, visible] of firstCommits) {
    if (!visible) expect(shown).not.toContain(form);
  }
});

it('a sheet opened on its first render keeps its first form', async () => {
  const screen = await render(<Sheet visible />);
  await act(async () => screen.rerender(<Sheet visible />));
  expect(new Set(commits.map((entry) => entry.form))).toEqual(new Set([1]));
});
