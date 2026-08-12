import { useChatStore } from "../store/useChatStore";

const TABS = [
  { id: "chats", label: "Chats" },
  { id: "contacts", label: "Contacts" },
];

/** daisyUI's `tabs tabs-boxed` was already neutralised with `bg-transparent` and
 *  never used `tab-active`, so this owes it nothing (DEC-13). */
function ActiveTabSwitch() {
  const { activeTab, setActiveTab } = useChatStore();

  return (
    <div
      role="tablist"
      className="mx-3 mb-1 flex gap-1 rounded-xl border border-line/10 bg-raised/30 p-1"
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? "bg-accent/15 text-accent-soft"
                : "text-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
export default ActiveTabSwitch;
