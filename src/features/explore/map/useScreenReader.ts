// Whether a screen reader (TalkBack) is on, kept current: the Explore map's
// pins then open their venue in one activation (iOS opens in one under
// VoiceOver or Switch Control), since a card that says "Tap again" is a step
// a screen reader user cannot see.
//
// TalkBack only, not "any accessibility service": Android counts password
// managers, launchers and automation apps as accessibility services too, and
// taking the card away from everyone running one would cost sighted members
// the preview. Switch Access users see the card and its "Open venue" button,
// so the two steps work for them as they are.
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useScreenReaderOn(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    // A change event wins over a slower first read.
    let changed = false;
    Promise.resolve(AccessibilityInfo.isScreenReaderEnabled())
      .then((value) => {
        if (live && !changed) setOn(value === true);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', (value: boolean) => {
      changed = true;
      if (live) setOn(value === true);
    });
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return on;
}
