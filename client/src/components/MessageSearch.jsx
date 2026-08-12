import { useEffect, useRef, useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { useChatStore } from "../store/useChatStore";

// Long enough that typing a word does not fire a query per character, short
// enough that the results feel attached to the keystrokes.
const DEBOUNCE_MS = 300;

/**
 * MSG-07. Searches every conversation the user is in; the server intersects
 * with membership, so scope is never the client's to decide.
 */
function MessageSearch() {
  const { searchMessages, conversations, selectConversation } = useChatStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  // guards against an earlier, slower query overwriting a later one
  const requestRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const id = ++requestRef.current;

    const timer = setTimeout(async () => {
      const found = await searchMessages(trimmed);
      if (id !== requestRef.current) return; // a newer search has started
      setResults(found);
      setIsSearching(false);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, searchMessages]);

  const titleFor = (conversationId) => {
    const conversation = conversations.find((c) => c._id === conversationId);
    if (!conversation) return "Conversation";
    return conversation.type === "group"
      ? conversation.name || "Unnamed group"
      : conversation.partner?.name ?? "Unknown";
  };

  return (
    <div className="px-3 pb-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search messages…"
          aria-label="Search messages"
          className="field py-2 pl-9 pr-8 text-sm"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-ink"
          >
            <XIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {query.trim().length >= 2 && (
        <div className="mt-2 max-h-60 space-y-1 overflow-y-auto" aria-live="polite">
          {isSearching && <p className="px-1 text-xs text-faint">Searching…</p>}

          {!isSearching && results.length === 0 && (
            // an empty result must be distinguishable from a failed search
            <p className="px-1 text-xs text-faint">No messages found</p>
          )}

          {results.map((result) => (
            <button
              key={result._id}
              type="button"
              onClick={() => {
                const conversation = conversations.find((c) => c._id === result.conversationId);
                if (conversation) selectConversation(conversation);
                setQuery("");
              }}
              className="w-full rounded-lg bg-raised/40 px-3 py-2 text-left transition-colors hover:bg-raised/70"
            >
              <p className="text-xs text-accent-soft">{titleFor(result.conversationId)}</p>
              <p className="truncate text-sm text-ink/90">{result.text}</p>
              <p className="text-[10px] text-faint">
                {new Date(result.createdAt).toLocaleDateString()}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default MessageSearch;
