import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowLeftIcon, ShieldIcon } from "lucide-react";
import { axiosInstance } from "../lib/axios";

/**
 * OBS-04 — the operator view.
 *
 * Reads the AuditEvent and ClientError collections and nothing else. There is
 * no log-file endpoint behind this on purpose (DEC-12): a file read on a
 * production server is a path-traversal target and would expose whatever
 * redaction missed, whereas these collections have no field for message content
 * at all.
 *
 * The guard here is cosmetic. The real one is requireAdmin, per route.
 */
const TABS = [
  { id: "audit", label: "Activity" },
  { id: "errors", label: "Errors" },
];

function AdminPage() {
  const [tab, setTab] = useState("audit");
  const [overview, setOverview] = useState(null);
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    axiosInstance
      .get("/admin/overview")
      .then(({ data }) => setOverview(data))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data } = await axiosInstance.get(`/admin/${tab}`);
      setRows(tab === "audit" ? data.events : data.errors);
    } catch {
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="relative z-10 mx-auto w-full max-w-5xl p-4">
      <div className="glass mb-4 flex items-center gap-3 rounded-2xl p-4">
        <Link to="/" aria-label="Back to Chatify" className="icon-btn">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <ShieldIcon className="h-5 w-5 text-accent-soft" />
        <h1 className="flex-1 font-medium text-ink">Operations</h1>
      </div>

      {overview && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Users", overview.users],
            ["Admins", overview.admins],
            ["Activity events", overview.auditEvents],
            ["Error groups", overview.clientErrors],
          ].map(([label, value]) => (
            <div key={label} className="glass rounded-xl p-3">
              <p className="text-xs text-muted">{label}</p>
              <p className="text-2xl font-semibold text-ink">{value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="glass overflow-hidden rounded-2xl">
        <div role="tablist" className="flex gap-1 border-b border-line/10 p-2">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                tab === entry.id ? "bg-accent/15 text-accent-soft" : "text-muted hover:text-ink"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-3">
          {isLoading && <p className="p-4 text-sm text-faint">Loading…</p>}
          {!isLoading && rows.length === 0 && (
            <p className="p-4 text-sm text-faint">Nothing recorded yet.</p>
          )}

          {!isLoading &&
            rows.map((row) =>
              tab === "audit" ? (
                <div key={row._id} className="border-b border-line/5 px-2 py-2 last:border-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-accent-soft">{row.action}</span>
                    <span className="truncate text-sm text-ink">{row.actor?.name ?? "Unknown"}</span>
                    <span className="ml-auto shrink-0 text-xs text-faint">
                      {new Date(row.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {Object.keys(row.metadata ?? {}).length > 0 && (
                    <p className="mt-0.5 font-mono text-[11px] text-muted">
                      {JSON.stringify(row.metadata)}
                    </p>
                  )}
                </div>
              ) : (
                <div key={row._id} className="border-b border-line/5 px-2 py-2 last:border-0">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm text-ink">{row.message}</span>
                    <span className="ml-auto shrink-0 rounded-full bg-danger/15 px-2 text-xs text-danger">
                      ×{row.count}
                    </span>
                  </div>
                  <p className="text-xs text-faint">
                    {row.kind} · {row.path || "/"} · last seen{" "}
                    {new Date(row.lastSeenAt).toLocaleString()}
                  </p>
                  {row.stack && (
                    <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted">
                      {row.stack}
                    </pre>
                  )}
                </div>
              )
            )}
        </div>
      </div>

      <p className="mt-3 text-xs text-faint">
        Message content is never recorded here — these collections have no field for it.
      </p>
    </div>
  );
}

export default AdminPage;
