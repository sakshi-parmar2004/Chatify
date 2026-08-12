import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ImageIcon, MicIcon, PaperclipIcon, SendIcon, SquareIcon, XIcon } from "lucide-react";
import useKeyboardSound from "../hooks/useKeyboardSound";
import useVoiceRecorder from "../hooks/useVoiceRecorder";
import { useChatStore } from "../store/useChatStore";
import { uploadFile } from "../lib/upload";

const formatDuration = (totalSeconds) => {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
};

function MessageInput() {
  const { playRandomKeyStrokeSound } = useKeyboardSound();
  const [text, setText] = useState("");
  // the local pick, before it has been uploaded
  const [pending, setPending] = useState(null);
  const [progress, setProgress] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const uploadRef = useRef(null);
  // object URLs have to be revoked by hand or the blob leaks for the session
  const previewUrlRef = useRef(null);

  const { sendMessage, isSoundEnabled, emitTyping, emitStopTyping, replyTarget, setReplyTarget } =
    useChatStore();
  const recorder = useVoiceRecorder();

  // leaving the conversation mid-sentence should not leave the other side
  // watching an indicator that never resolves
  useEffect(() => emitStopTyping, [emitStopTyping]);

  useEffect(() => {
    if (recorder.error) toast.error(recorder.error);
  }, [recorder.error]);

  const clearPending = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPending(null);
    setProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  const acceptFile = (file) => {
    if (!file) return;

    clearPending();
    const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    previewUrlRef.current = previewUrl;
    setPending({ file, previewUrl });
  };

  const handleSendMessage = async (event) => {
    event.preventDefault();
    if (!text.trim() && !pending) return;
    if (isSoundEnabled) playRandomKeyStrokeSound();

    // the message itself supersedes the indicator
    emitStopTyping();

    let attachment;
    if (pending) {
      try {
        setProgress(0);
        const upload = uploadFile(pending.file, { onProgress: setProgress });
        uploadRef.current = upload;
        attachment = await upload.promise;
      } catch (error) {
        // a cancelled upload is a decision, not a failure worth reporting
        if (error?.name !== "AbortError") {
          toast.error(error?.response?.data?.message || "Upload failed");
        }
        setProgress(null);
        uploadRef.current = null;
        return;
      }
      uploadRef.current = null;
    }

    sendMessage({
      text: text.trim(),
      ...(attachment ? { attachment } : {}),
      // MSG-05 — the server takes the snapshot; this is only the pointer
      ...(replyTarget ? { replyTo: replyTarget._id } : {}),
    });

    setText("");
    clearPending();
  };

  const cancelUpload = () => {
    uploadRef.current?.abort();
    uploadRef.current = null;
    setProgress(null);
  };

  const finishRecording = async ({ discard }) => {
    const file = await recorder.stop({ discard });
    if (file) acceptFile(file);
  };

  // MED-06
  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    acceptFile(event.dataTransfer.files?.[0]);
  };

  const handlePaste = (event) => {
    const file = [...(event.clipboardData?.files ?? [])][0];
    // otherwise a pasted screenshot lands in the text box as a data URI
    if (file) {
      event.preventDefault();
      acceptFile(file);
    }
  };

  const isUploading = progress !== null;

  return (
    <div
      className={`p-3 sm:p-4 border-t border-slate-700/50 shrink-0 relative ${
        isDragging ? "bg-cyan-500/10" : ""
      }`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-2 rounded-lg border-2 border-dashed border-cyan-400 flex items-center justify-center pointer-events-none">
          <p className="text-cyan-300 text-sm">Drop to attach</p>
        </div>
      )}

      {replyTarget && (
        <div className="max-w-3xl mx-auto mb-2 flex items-center gap-2 rounded-lg bg-slate-800/60 border-l-2 border-cyan-500 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-cyan-400">Replying to</p>
            <p className="text-sm text-slate-300 truncate">
              {replyTarget.text || (replyTarget.image || replyTarget.attachment ? "Attachment" : "")}
            </p>
          </div>
          <button
            type="button"
            aria-label="Cancel reply"
            onClick={() => setReplyTarget(null)}
            className="shrink-0 text-slate-400 hover:text-slate-200"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      {recorder.isRecording && (
        <div className="max-w-3xl mx-auto mb-3 flex items-center gap-3 rounded-lg bg-slate-800/60 px-3 py-2">
          <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
          <span className="text-sm text-slate-300" aria-live="polite">
            Recording {formatDuration(recorder.seconds)}
          </span>
          <button
            type="button"
            onClick={() => finishRecording({ discard: true })}
            className="ml-auto text-xs text-slate-400 hover:text-slate-200"
          >
            Discard
          </button>
          <button
            type="button"
            aria-label="Stop recording"
            onClick={() => finishRecording({ discard: false })}
            className="text-cyan-400 hover:text-cyan-300"
          >
            <SquareIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      {pending && (
        <div className="max-w-3xl mx-auto mb-3 flex items-center gap-3">
          <div className="relative">
            {pending.previewUrl ? (
              <img
                src={pending.previewUrl}
                alt="Preview"
                className="w-20 h-20 object-cover rounded-lg border border-slate-700"
              />
            ) : (
              <div className="w-20 h-20 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center px-2">
                <span className="text-[10px] text-slate-300 text-center break-all line-clamp-3">
                  {pending.file.name}
                </span>
              </div>
            )}
            {!isUploading && (
              <button
                onClick={clearPending}
                aria-label="Remove attachment"
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-slate-200 hover:bg-slate-700"
                type="button"
              >
                <XIcon className="w-4 h-4" />
              </button>
            )}
          </div>

          {isUploading && (
            <div className="flex-1 min-w-0">
              {/* real bytes transferred, not a fake animation */}
              <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-slate-400" aria-live="polite">
                  Uploading {progress}%
                </span>
                <button
                  type="button"
                  onClick={cancelUpload}
                  className="text-xs text-slate-400 hover:text-rose-400"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <form
        onSubmit={handleSendMessage}
        className="max-w-3xl mx-auto flex items-center gap-2 sm:gap-4"
      >
        <input
          type="text"
          value={text}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            if (isSoundEnabled) playRandomKeyStrokeSound();
            // clearing the box is a deliberate "never mind", not a pause
            if (next.trim()) emitTyping();
            else emitStopTyping();
          }}
          onPaste={handlePaste}
          className="flex-1 min-w-0 bg-slate-800/50 border border-slate-700/50 rounded-lg py-2 px-3 sm:px-4 text-slate-200 placeholder-slate-400"
          placeholder="Type your message..."
        />

        <input
          type="file"
          accept="image/*"
          ref={imageInputRef}
          onChange={(event) => acceptFile(event.target.files?.[0])}
          className="hidden"
        />
        <input
          type="file"
          ref={fileInputRef}
          onChange={(event) => acceptFile(event.target.files?.[0])}
          className="hidden"
        />

        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          aria-label="Attach an image"
          disabled={isUploading}
          className={`shrink-0 bg-slate-800/50 text-slate-400 hover:text-slate-200 rounded-lg px-3 py-2 transition-colors disabled:opacity-50 ${
            pending?.previewUrl ? "text-cyan-500" : ""
          }`}
        >
          <ImageIcon className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach a file"
          disabled={isUploading}
          className="shrink-0 bg-slate-800/50 text-slate-400 hover:text-slate-200 rounded-lg px-3 py-2 transition-colors disabled:opacity-50"
        >
          <PaperclipIcon className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={() =>
            recorder.isRecording ? finishRecording({ discard: false }) : recorder.start()
          }
          aria-label={recorder.isRecording ? "Stop recording" : "Record a voice message"}
          disabled={isUploading}
          className={`shrink-0 bg-slate-800/50 rounded-lg px-3 py-2 transition-colors disabled:opacity-50 ${
            recorder.isRecording ? "text-rose-400" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <MicIcon className="w-5 h-5" />
        </button>

        <button
          type="submit"
          disabled={(!text.trim() && !pending) || isUploading}
          aria-label="Send message"
          className="shrink-0 bg-gradient-to-r from-cyan-500 to-cyan-600 text-white rounded-lg px-3 sm:px-4 py-2 font-medium hover:from-cyan-600 hover:to-cyan-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <SendIcon className="w-5 h-5" />
        </button>
      </form>
    </div>
  );
}
export default MessageInput;
