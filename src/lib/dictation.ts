/**
 * The microphone, and the one rule that matters about it.
 *
 * Browsers have had speech recognition for years, and until recently all of it
 * worked by streaming the audio to the vendor's servers — Chrome's to Google,
 * Safari's to Apple. Dictating a narrative through that would send criminal
 * justice information to a third party, which is a CJIS violation and a thing
 * no agency would forgive.
 *
 * So this file only ever uses the on-device path, and locks it twice:
 *
 *  1. The button is only offered when `available({ processLocally: true })`
 *     says the local model is installed. Asking without `processLocally` is
 *     what reports the *cloud* engine as available, so it is never asked that
 *     way here.
 *  2. `recognition.processLocally = true` is set on every session. With it set
 *     the browser will not fall back to the network — it raises an error
 *     instead, which is the outcome we want.
 *
 * There is no third path. If a browser cannot transcribe locally, this reports
 * that plainly and the officer types, which is what they do today.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/* ------------------------------------------------------------------ */
/* The bits of the API this file uses                                  */
/* ------------------------------------------------------------------ */

type LocalAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally: boolean;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike;
  available?(options: { langs: string[]; processLocally: boolean }): Promise<LocalAvailability>;
  install?(options: { langs: string[]; processLocally: boolean }): Promise<boolean>;
}

function constructorFor(): SpeechRecognitionConstructor | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    | SpeechRecognitionConstructor
    | null;
}

/* ------------------------------------------------------------------ */
/* State the button renders from                                       */
/* ------------------------------------------------------------------ */

export type DictationState =
  /** This browser has no on-device engine. The officer types. */
  | 'unsupported'
  /** It has one, but the model is not on this machine yet. */
  | 'downloadable'
  | 'downloading'
  | 'ready'
  | 'listening'
  /** The microphone was refused, which only the officer can undo. */
  | 'denied'
  | 'error';

export interface Dictation {
  state: DictationState;
  /** Words heard but not yet settled. Shown greyed, never saved on their own. */
  interim: string;
  /** Why it stopped, in words an officer can act on. */
  message: string;
  /** Fetches the on-device model. One download per machine, then it is local. */
  install: () => Promise<void>;
  start: () => void;
  stop: () => void;
}

const LANG_OPTIONS = (lang: string) => ({ langs: [lang], processLocally: true });

/** How often to re-ask whether the model has landed, while it downloads. */
const POLL_MS = 3_000;
/** Long enough for a real model on a slow link; short enough to not be a hang. */
const INSTALL_TIMEOUT_MS = 5 * 60_000;

const MODEL_FAILED = 'The speech model could not be installed on this machine.';

/**
 * Dictation for one field.
 *
 * `onText` is called with each settled phrase — never with interim words, which
 * change as the engine hears more and have no business in a police report until
 * the engine has committed to them.
 */
export function useDictation(onText: (chunk: string) => void, lang = 'en-US'): Dictation {
  const [state, setState] = useState<DictationState>('unsupported');
  const [interim, setInterim] = useState('');
  const [message, setMessage] = useState('');

  const session = useRef<SpeechRecognitionLike | null>(null);
  // Held in a ref so restarting the engine mid-dictation does not need a new
  // session, and so the callback is never stale inside a long-lived listener.
  const emit = useRef(onText);
  emit.current = onText;
  /** True while the officer means to be dictating, across engine restarts. */
  const wanted = useRef(false);
  /** Stops the install poll if the screen closes while it is still running. */
  const stopInstall = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    const SR = constructorFor();
    if (!SR?.available) {
      setState('unsupported');
      return;
    }
    void SR.available(LANG_OPTIONS(lang))
      .then((availability) => {
        if (cancelled) return;
        setState(
          availability === 'available'
            ? 'ready'
            : availability === 'downloading'
              ? 'downloading'
              : availability === 'downloadable'
                ? 'downloadable'
                : 'unsupported',
        );
      })
      .catch(() => !cancelled && setState('unsupported'));
    return () => {
      cancelled = true;
    };
  }, [lang]);

  // Whatever happens, the microphone stops when the screen goes away.
  useEffect(
    () => () => {
      wanted.current = false;
      session.current?.abort();
      stopInstall.current();
    },
    [],
  );

  /**
   * Fetches the on-device model.
   *
   * `install()` resolves when the download finishes — and on a machine whose
   * component updater is blocked, which is any machine behind a strict
   * proxy, it may never resolve at all. So the promise is not the only thing
   * watched: `available()` is polled alongside it, which also catches the
   * download another tab or another user started, and the whole thing gives
   * up after a while rather than leaving a spinner on the screen forever.
   */
  const install = useCallback(async () => {
    const SR = constructorFor();
    if (!SR?.install || !SR.available) return;
    setState('downloading');
    setMessage('');

    let settled = false;
    const finish = (next: DictationState, why = '') => {
      if (settled) return;
      settled = true;
      window.clearInterval(poll);
      window.clearTimeout(giveUp);
      setState(next);
      setMessage(why);
    };

    const poll = window.setInterval(() => {
      void SR.available!(LANG_OPTIONS(lang)).then((availability) => {
        if (availability === 'available') finish('ready');
      });
    }, POLL_MS);

    const giveUp = window.setTimeout(
      () =>
        finish(
          'downloadable',
          'The speech model is still downloading, or this machine cannot reach the download. It is safe to carry on typing and try again later.',
        ),
      INSTALL_TIMEOUT_MS,
    );

    stopInstall.current = () => {
      settled = true;
      window.clearInterval(poll);
      window.clearTimeout(giveUp);
    };

    try {
      const ok = await SR.install(LANG_OPTIONS(lang));
      finish(ok ? 'ready' : 'unsupported', ok ? '' : MODEL_FAILED);
    } catch {
      finish('unsupported', MODEL_FAILED);
    }
  }, [lang]);

  const stop = useCallback(() => {
    wanted.current = false;
    session.current?.stop();
    setInterim('');
  }, []);

  const start = useCallback(() => {
    const SR = constructorFor();
    if (!SR) return;

    const recognition = new SR();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    // The lock. Without this the browser is free to use the network engine.
    recognition.processLocally = true;

    recognition.addEventListener('result', (event) => {
      const e = event as unknown as {
        resultIndex: number;
        results: { isFinal: boolean; 0: { transcript: string } }[];
      };
      let pending = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const result = e.results[i];
        if (result.isFinal) emit.current(result[0].transcript);
        else pending += result[0].transcript;
      }
      setInterim(pending);
    });

    recognition.addEventListener('error', (event) => {
      const code = (event as unknown as { error?: string }).error ?? '';
      wanted.current = false;
      setInterim('');
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setState('denied');
        setMessage(
          'The microphone was refused. Allow it for this site in the browser’s address bar, then try again.',
        );
      } else if (code === 'no-speech' || code === 'aborted') {
        setState('ready');
        setMessage('');
      } else if (code === 'language-not-supported') {
        setState('unsupported');
        setMessage('This machine has no on-device speech model, and nothing is sent off it.');
      } else {
        setState('error');
        setMessage('Dictation stopped. Nothing was lost — carry on typing, or start it again.');
      }
    });

    recognition.addEventListener('end', () => {
      /*
        The engine stops itself after a pause, which is not what the officer
        asked for. Restarting keeps a long narrative going without them having
        to press the button after every sentence.
      */
      if (wanted.current) {
        try {
          recognition.start();
          return;
        } catch {
          wanted.current = false;
        }
      }
      session.current = null;
      setInterim('');
      setState((current) => (current === 'listening' ? 'ready' : current));
    });

    try {
      recognition.start();
      session.current = recognition;
      wanted.current = true;
      setMessage('');
      setState('listening');
    } catch {
      setState('error');
      setMessage('Dictation could not start.');
    }
  }, [lang]);

  return { state, interim, message, install, start, stop };
}
