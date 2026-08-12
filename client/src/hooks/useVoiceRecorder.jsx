import { useCallback, useEffect, useRef, useState } from "react";

/**
 * MED-04 — record a voice note.
 *
 * The microphone permission is requested when recording starts, not on mount:
 * asking before the user has expressed any intent is how permission prompts get
 * denied permanently.
 *
 * Every track is stopped on cleanup. A MediaStream left open keeps the OS
 * recording indicator lit, which reads as the app listening in the background.
 */
const MAX_SECONDS = 300;

export function useVoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState(null);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  // covers navigating away or unmounting mid-recording
  useEffect(() => releaseStream, [releaseStream]);

  const start = useCallback(async () => {
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Recording is not supported in this browser.");
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });

      recorder.start();
      setIsRecording(true);
      setSeconds(0);

      timerRef.current = setInterval(() => {
        setSeconds((value) => {
          // a recording left running by accident should not become a 2GB upload
          if (value + 1 >= MAX_SECONDS) recorder.stop();
          return value + 1;
        });
      }, 1000);

      return true;
    } catch {
      // a denied permission is a choice, not an error to shout about
      setError("Microphone access was not granted.");
      releaseStream();
      return false;
    }
  }, [releaseStream]);

  /** @returns a File, or null if the recording was discarded or empty. */
  const stop = useCallback(
    ({ discard = false } = {}) =>
      new Promise((resolve) => {
        const recorder = recorderRef.current;
        if (!recorder || recorder.state === "inactive") {
          releaseStream();
          setIsRecording(false);
          return resolve(null);
        }

        recorder.addEventListener(
          "stop",
          () => {
            const chunks = chunksRef.current;
            releaseStream();
            setIsRecording(false);

            if (discard || chunks.length === 0) return resolve(null);

            const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
            const extension = (recorder.mimeType || "audio/webm").includes("mp4") ? "m4a" : "webm";
            resolve(new File([blob], `voice-note.${extension}`, { type: blob.type }));
          },
          { once: true }
        );

        recorder.stop();
      }),
    [releaseStream]
  );

  return { isRecording, seconds, error, start, stop };
}

export default useVoiceRecorder;
