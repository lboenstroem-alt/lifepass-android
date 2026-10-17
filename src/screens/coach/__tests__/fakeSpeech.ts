/**
 * A stand-in for expo-speech-recognition's native module (absent under
 * Jest): records what the Coach asked of it and lets a test play the
 * recogniser's events.
 *
 *   jest.mock('expo-speech-recognition', () => ({
 *     ExpoSpeechRecognitionModule: require('./fakeSpeech').fakeSpeech,
 *   }));
 */
type Listener = (event: never) => void;

export interface StartOptions {
  readonly lang: string;
  readonly interimResults: boolean;
  readonly continuous: boolean;
  readonly requiresOnDeviceRecognition: boolean;
}

const listeners = new Map<string, Set<Listener>>();

export const fakeSpeech = {
  /** What the permission prompt answers. */
  granted: true,
  /** A speech service is installed. */
  available: true,
  /** The phone recognises US English on the device. */
  onDevice: true,
  started: [] as StartOptions[],
  stops: 0,

  addListener(name: string, listener: Listener) {
    const set = listeners.get(name) ?? new Set<Listener>();
    set.add(listener);
    listeners.set(name, set);
    return { remove: () => set.delete(listener) };
  },
  async requestPermissionsAsync() {
    return { granted: fakeSpeech.granted, status: fakeSpeech.granted ? 'granted' : 'denied', canAskAgain: false };
  },
  isRecognitionAvailable() {
    return fakeSpeech.available;
  },
  supportsOnDeviceRecognition() {
    return fakeSpeech.onDevice;
  },
  start(options: StartOptions) {
    fakeSpeech.started.push(options);
    fakeSpeech.emit('start', {});
  },
  stop() {
    fakeSpeech.stops += 1;
    fakeSpeech.emit('end', {});
  },

  /** Plays a recogniser event (`start`, `result`, `error`, `end`). */
  emit(name: string, event: unknown) {
    for (const listener of [...(listeners.get(name) ?? [])]) listener(event as never);
  },
  /** A transcript so far (partial) or the final one. */
  result(transcript: string, isFinal = false) {
    fakeSpeech.emit('result', { isFinal, results: [{ transcript, confidence: 1, segments: [] }] });
  },
  reset() {
    fakeSpeech.granted = true;
    fakeSpeech.available = true;
    fakeSpeech.onDevice = true;
    fakeSpeech.started.length = 0;
    fakeSpeech.stops = 0;
  },
};
