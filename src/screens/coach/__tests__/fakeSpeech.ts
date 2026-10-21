/**
 * A stand-in for expo-speech-recognition's native module (absent under
 * Jest): records what the Coach asked of it and lets a test play the
 * recogniser's events. Like the native module, `stop()` delivers a final
 * result before 'end' (ExpoSpeechService.stop: "emits a final result if
 * there is one"), and `abort()` delivers none ('error' aborted, then 'end').
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
  aborts: 0,
  /** 'start' is emitted as `start()` is called; off, a test emits it (the recogniser getting ready). */
  autoStart: true,
  /** Held permission prompt: `requestPermissionsAsync` waits until `answerPermission()`. */
  holdPermission: false,
  /** The words heard so far (what `stop()` delivers as its final result). */
  heard: '',
  pendingPermission: [] as (() => void)[],

  addListener(name: string, listener: Listener) {
    const set = listeners.get(name) ?? new Set<Listener>();
    set.add(listener);
    listeners.set(name, set);
    return { remove: () => set.delete(listener) };
  },
  async requestPermissionsAsync() {
    if (fakeSpeech.holdPermission) await new Promise<void>((resolve) => fakeSpeech.pendingPermission.push(resolve));
    return { granted: fakeSpeech.granted, status: fakeSpeech.granted ? 'granted' : 'denied', canAskAgain: false };
  },
  /** Answers a held permission prompt. */
  answerPermission() {
    for (const resolve of fakeSpeech.pendingPermission.splice(0)) resolve();
  },
  isRecognitionAvailable() {
    return fakeSpeech.available;
  },
  supportsOnDeviceRecognition() {
    return fakeSpeech.onDevice;
  },
  start(options: StartOptions) {
    fakeSpeech.started.push(options);
    if (fakeSpeech.autoStart) fakeSpeech.emit('start', {});
  },
  stop() {
    fakeSpeech.stops += 1;
    if (fakeSpeech.heard) fakeSpeech.result(fakeSpeech.heard, true);
    fakeSpeech.emit('end', {});
  },
  abort() {
    fakeSpeech.aborts += 1;
    fakeSpeech.emit('error', { error: 'aborted', message: '' });
    fakeSpeech.emit('end', {});
  },

  /** Plays a recogniser event (`start`, `result`, `error`, `end`). */
  emit(name: string, event: unknown) {
    for (const listener of [...(listeners.get(name) ?? [])]) listener(event as never);
  },
  /** A transcript so far (partial) or the final one. */
  result(transcript: string, isFinal = false) {
    fakeSpeech.heard = transcript;
    fakeSpeech.emit('result', { isFinal, results: [{ transcript, confidence: 1, segments: [] }] });
  },
  reset() {
    fakeSpeech.granted = true;
    fakeSpeech.available = true;
    fakeSpeech.onDevice = true;
    fakeSpeech.started.length = 0;
    fakeSpeech.stops = 0;
    fakeSpeech.aborts = 0;
    fakeSpeech.autoStart = true;
    fakeSpeech.holdPermission = false;
    fakeSpeech.heard = '';
    fakeSpeech.pendingPermission.length = 0;
  },
};
