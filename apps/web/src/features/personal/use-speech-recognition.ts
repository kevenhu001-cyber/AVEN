'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Browser dictation over the Web Speech API. It fills the composer draft only; the
 * full-screen voice conversation mode stays a labelled placeholder because there is
 * no speech-to-speech backend. Recognition availability differs per browser, so the
 * composer keeps its "not available yet" fallback when the API is missing.
 */
type SpeechAlternative = { transcript: string };
type SpeechResultItem = { isFinal: boolean; 0: SpeechAlternative };
type SpeechResultList = { length: number; [index: number]: SpeechResultItem };
type SpeechEvent = { resultIndex: number; results: SpeechResultList };
type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};
type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

export function speechSupported(): boolean {
  return Boolean(recognitionCtor());
}

/** Append dictated text to the draft; Latin/digit runs get a space boundary, CJK joins directly. */
export function appendDictation(draft: string, text: string): string {
  const addition = text.trim();
  if (!addition) return draft;
  if (!draft) return addition;
  const latinTail = /[\p{Script=Latin}0-9]$/u.test(draft);
  const latinHead = /^[\p{Script=Latin}0-9]/u.test(addition);
  return `${draft}${latinTail && latinHead ? ' ' : ''}${addition}`;
}

export function useSpeechRecognition(options: {
  onFinal: (text: string) => void;
  onError: (code: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const instance = useRef<RecognitionLike | null>(null);
  const handlers = useRef(options);
  // Keep the latest callbacks without re-creating the recognizer on every render.
  useEffect(() => {
    handlers.current = options;
  });

  const stop = useCallback(() => {
    instance.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback((): boolean => {
    const Ctor = recognitionCtor();
    if (!Ctor) return false;
    instance.current?.abort();
    const recognition = new Ctor();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        const text = result?.[0]?.transcript;
        if (result?.isFinal && text) handlers.current.onFinal(text);
      }
    };
    recognition.onend = () => {
      instance.current = null;
      setListening(false);
    };
    recognition.onerror = (event) => {
      instance.current = null;
      setListening(false);
      // A silent room or an explicit stop are not failures worth surfacing.
      if (event.error !== 'no-speech' && event.error !== 'aborted')
        handlers.current.onError(event.error);
    };
    recognition.start();
    instance.current = recognition;
    setListening(true);
    return true;
  }, []);

  useEffect(
    () => () => {
      instance.current?.abort();
    },
    [],
  );

  return { supported: speechSupported(), listening, start, stop };
}
