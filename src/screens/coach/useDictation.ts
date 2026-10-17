/* eslint lifepass/no-literal-copy: "error" */
// Dictation into the Coach's input (iOS CoachView.swift `SpeechRecognizer`
// and `startDictation`), through expo-speech-recognition.
//
// - A tap asks for the microphone; refused (now or before), the alert points
//   to Settings, in the account language (coach.mic.*), as iOS does: a dead,
//   silent mic is worse than a sentence.
// - US English for every account (Icelandic is not dictated), ON THE PHONE
//   where the phone can (owner decision D12): if the on-device recogniser
//   refuses the language or the service, it is asked once more through the
//   system recogniser.
// - Partial transcripts stream into the input; it stops on a final result,
//   an error, a tap, or the Coach tab losing focus. Nothing is sent until
//   the member taps send.
//
// The native module does not exist in Expo Go (its import throws there): the
// hook then reports `available: false` and the screen shows no mic.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Linking } from 'react-native';

import { showDialog } from '../../components/ui';
import { t } from '../../i18n';

type SpeechPackage = typeof import('expo-speech-recognition');
type SpeechModule = SpeechPackage['ExpoSpeechRecognitionModule'];

let cachedModule: SpeechModule | null | undefined;

/** The native recogniser, or null where it is missing (Expo Go, a test). */
export function speechModule(): SpeechModule | null {
  if (cachedModule !== undefined) return cachedModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = (require('expo-speech-recognition') as SpeechPackage).ExpoSpeechRecognitionModule ?? null;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

/** Forget the cached module (tests that swap it). */
export function resetSpeechModuleForTests(): void {
  cachedModule = undefined;
}

/** The recogniser's language for every account (iOS `SFSpeechRecognizer(locale: en-US)`). */
export const DICTATION_LANG = 'en-US';

/** Errors after which the on-device recogniser is not the one to use: the system one is asked once. */
const ON_DEVICE_REFUSALS: readonly string[] = ['language-not-supported', 'service-not-allowed'];

export interface Dictation {
  /** The phone can dictate at all (the native module is present). */
  readonly available: boolean;
  readonly isRecording: boolean;
  /** Asks for the microphone and starts listening; partial text goes to `onTranscript`. */
  start(): Promise<void>;
  /** Stops listening (safe to call at any time). */
  stop(): void;
}

function showMicDenied(): void {
  showDialog({
    title: t('coach.mic.denied_title'),
    message: t('coach.mic.denied_body'),
    buttons: [
      { label: t('common.cancel'), role: 'cancel' },
      { label: t('coach.mic.open_settings'), onPress: () => void Linking.openSettings() },
    ],
  });
}

/**
 * A phone with no speech service at all (iOS always has one). The sentence is
 * the whole notice: "Microphone access needed" would send the member to a
 * setting that cannot help.
 */
function showUnavailable(): void {
  showDialog({
    title: t('coach.android.voice_unavailable'),
    buttons: [{ label: t('common.ok'), role: 'cancel' }],
  });
}

export function useDictation(onTranscript: (text: string) => void): Dictation {
  const speech = speechModule();
  const [isRecording, setRecording] = useState(false);
  const recordingRef = useRef(false);
  const latestTranscript = useRef(onTranscript);
  latestTranscript.current = onTranscript;
  /** This attempt asked for the on-device recogniser and has heard nothing yet. */
  const onDeviceAttempt = useRef(false);

  const setRecordingBoth = (value: boolean) => {
    recordingRef.current = value;
    setRecording(value);
  };

  const begin = useCallback(
    (onDevice: boolean) => {
      if (!speech) return;
      onDeviceAttempt.current = onDevice;
      speech.start({
        lang: DICTATION_LANG,
        interimResults: true,
        continuous: false,
        requiresOnDeviceRecognition: onDevice,
      });
    },
    [speech],
  );

  useEffect(() => {
    if (!speech) return undefined;
    const subscriptions = [
      speech.addListener('start', () => setRecordingBoth(true)),
      speech.addListener('end', () => setRecordingBoth(false)),
      speech.addListener('result', (event) => {
        onDeviceAttempt.current = false;
        const transcript = event.results[0]?.transcript ?? '';
        if (recordingRef.current || transcript) latestTranscript.current(transcript);
      }),
      speech.addListener('error', (event) => {
        if (onDeviceAttempt.current && ON_DEVICE_REFUSALS.includes(event.error)) {
          // The phone's own recogniser cannot take US English after all:
          // the system recogniser, once.
          begin(false);
          return;
        }
        setRecordingBoth(false);
      }),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, [speech, begin]);

  const stop = useCallback(() => {
    if (!speech || !recordingRef.current) return;
    try {
      speech.stop();
    } catch {
      // Already stopped.
    }
    setRecordingBoth(false);
  }, [speech]);

  // Leaving (the tab losing focus unmounts nothing, so the screen calls
  // `stop` on blur; this covers the screen going away).
  useEffect(() => () => stop(), [stop]);

  const start = useCallback(async () => {
    if (!speech) return;
    let granted = false;
    try {
      granted = (await speech.requestPermissionsAsync()).granted;
    } catch {
      granted = false;
    }
    if (!granted) {
      showMicDenied();
      return;
    }
    let ready = false;
    try {
      ready = speech.isRecognitionAvailable();
    } catch {
      ready = false;
    }
    if (!ready) {
      showUnavailable();
      return;
    }
    Keyboard.dismiss();
    let onDevice = false;
    try {
      onDevice = speech.supportsOnDeviceRecognition();
    } catch {
      onDevice = false;
    }
    latestTranscript.current('');
    begin(onDevice);
  }, [speech, begin]);

  return { available: speech !== null, isRecording, start, stop };
}
