import { useState, useRef, useCallback, useEffect } from "react";
import jig from "../../jigs/srm-house-style.json";
import { analyzeItem, getProseText, applyFixToHtml } from "../engine/index.js";
import { loadConfig, resolveProvider, DEFAULT_CONFIG } from "./deployment.js";

/* ============================================================
   Polish v2 — by Six Red Marbles
   Layered engine:
     1. Deterministic pass (client-side, free, hard protect walls)
        — mechanical, accessibility, AI-tells, house-style.
     2. AI editorial pass (judgment only) — sees prose, never code/math/links.
   The config is the licensable artifact. In production it is fetched from the
   versioned config host and origin-gated. Here it's embedded as the default.
   ============================================================ */


const COLORS = {
  bg: "#f8f9fb", surface: "#ffffff", surface2: "#f1f3f5", border: "#dfe2e6", borderLight: "#eceef0",
  accent: "#1a7f45", accentLight: "rgba(26,127,69,0.08)", text: "#1a1a1a", muted: "#5c6370", mutedLight: "#8b949e",
  red: "#e03131", redBg: "#fef2f2", redBorder: "#fecaca",
};

// category -> color/label
const CAT = {
  mechanical:   { color: "#1971c2", bg: "#eff6ff", border: "#bfdbfe", label: "Mechanical" },
  accessibility:{ color: "#0d9488", bg: "#f0fdfa", border: "#99f6e4", label: "Accessibility" },
  "ai-tell":    { color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe", label: "AI-tell" },
  "house-style":{ color: "#e67700", bg: "#fffbeb", border: "#fde68a", label: "House style" },
  grammar:      { color: "#e67700", bg: "#fffbeb", border: "#fde68a", label: "Grammar" },
  usage:        { color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe", label: "Usage" },
  spelling:     { color: "#e03131", bg: "#fef2f2", border: "#fecaca", label: "Spelling" },
  clarity:      { color: "#0d9488", bg: "#f0fdfa", border: "#99f6e4", label: "Clarity" },
  editorial:    { color: "#0d9488", bg: "#f0fdfa", border: "#99f6e4", label: "Editorial" },
};
const catMeta = c => CAT[c] || CAT.mechanical;

const TIER = {
  auto:    { label: "AUTO", color: COLORS.accent, hint: "applied, with undo" },
  suggest: { label: "SUGGEST", color: "#1971c2", hint: "review" },
  flag:    { label: "FLAG", color: "#7c3aed", hint: "human review" },
};

const FOLDERS = [
  { path: "wiki_content/", label: "Pages", icon: "📄", student: false },
  { path: "assignments/", label: "Assignments", icon: "📝", student: false },
  { path: "discussion_topics/", label: "Discussions", icon: "💬", student: true },
  { path: "quiz_export/", label: "Quizzes", icon: "✅", student: false },
];

/* ---------- HTML helpers ---------- */
function extractTitle(html) {
  if (!html) return null;
  const m = html.match(/<title>([^<]+)<\/title>/i);
  if (m) return m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
  const h = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  return h ? h[1].trim() : null;
}


export default function Polish() {
  const [step, setStep] = useState("setup");
  const [apiKey, setApiKey] = useState("");
  const [useAI, setUseAI] = useState(true);
  const [deploy, setDeploy] = useState(DEFAULT_CONFIG);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [zipName, setZipName] = useState("");
  const [courseId, setCourseId] = useState("");
  const [courseTitle, setCourseTitle] = useState("");
  const [hasStudentContent, setHasStudentContent] = useState(false);
  const [items, setItems] = useState([]);
  const [results, setResults] = useState([]);
  const [progress, setProgress] = useState({ current: 0, total: 0, label: "" });
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState({});
  const [error, setError] = useState("");
  const [log, setLog] = useState([]);
  const [zipReady, setZipReady] = useState(false);
  const fileRef = useRef(null);
  const abortRef = useRef(false);

  useEffect(() => {
    if (window.JSZip) { setZipReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    s.onload = () => setZipReady(true);
    s.onerror = () => setError("Failed to load JSZip from CDN.");
    document.head.appendChild(s);
  }, []);

  useEffect(() => { loadConfig().then(setDeploy); }, []);

  const addLog = useCallback((msg, color) => {
    setLog(p => [...p, { msg, color: color || COLORS.muted }]);
  }, []);

  async function handleZip(file) {
    setError(""); setZipName(file.name); setCourseId(""); setCourseTitle(""); setHasStudentContent(false);
    addLog("Reading " + file.name + "…", COLORS.accent);
    try {
      const zip = await window.JSZip.loadAsync(file);
      const idMatch = file.name.match(/canvas_course_(\d+)/);
      if (idMatch) setCourseId(idMatch[1]);
      const idx = zip.files["_index.html"];
      if (idx) { try { const t = extractTitle(await idx.async("string")); if (t) { setCourseTitle(t); addLog("📚 " + t, COLORS.accent); } } catch {} }

      const extracted = [];
      let studentSeen = false;
      for (const folder of FOLDERS) {
        const fs = Object.keys(zip.files).filter(f =>
          f.startsWith(folder.path) && f.endsWith(".html") && !f.endsWith("_index.html") && !f.endsWith("_files_manifest.html"));
        for (const fp of fs) {
          const html = await zip.files[fp].async("string");
          const prose = getProseText(html, jig.protect);
          const title = extractTitle(html) || fp.split("/").pop().replace(".html", "").replace(/-/g, " ");
          if (prose.replace(/\s/g, "").length > 20)
            extracted.push({ path: fp, folder: folder.label, icon: folder.icon, student: folder.student, title, html });
        }
        if (fs.length) { addLog(folder.icon + " " + fs.length + " " + folder.label.toLowerCase(), COLORS.accent); if (folder.student) studentSeen = true; }
      }
      setHasStudentContent(studentSeen);
      setItems(extracted);
      addLog("Ready: " + extracted.length + " items", COLORS.accent);
    } catch (e) {
      setError("Failed to read ZIP: " + e.message);
      addLog("Error: " + e.message, COLORS.red);
    }
  }

  async function runCheck() {
    if (items.length === 0) { setError("Upload a Gather ZIP first"); return; }
    setStep("checking"); setError(""); abortRef.current = false;

    // The deployment config decides the path: SRM-key proxy, client's own key,
    // or deterministic-only. The engine never knows which — it just gets a provider.
    const provider = resolveProvider(deploy, { useAI, clientApiKey: apiKey.trim() });
    if (useAI && !provider) {
      addLog(
        deploy.mode === "srm" ? "Editorial pass unavailable (proxy not configured) — deterministic only"
          : "No key — editorial pass skipped (deterministic only)",
        "#e67700"
      );
    } else if (provider) {
      addLog("Editorial pass: " + (provider.mode === "srm-key" ? "SRM" : "your key"), COLORS.muted);
    }

    const all = [];
    for (let i = 0; i < items.length; i++) {
      if (abortRef.current) { addLog("Stopped", "#e67700"); break; }
      const item = items[i];
      setProgress({ current: i + 1, total: items.length, label: item.title });
      addLog("[" + (i + 1) + "/" + items.length + "] " + item.title, COLORS.text);
      try {
        const { issues, fixedHtml } = await analyzeItem(item.html, jig, provider);
        const aiN = issues.filter(x => x.source === "ai").length;
        addLog("  • " + (issues.length - aiN) + " deterministic" + (provider ? "  → " + aiN + " editorial" : ""), COLORS.muted);
        all.push({ ...item, issues, fixedHtml });
      } catch (e) {
        addLog("  ✗ " + e.message, COLORS.red);
        all.push({ ...item, issues: [], fixedHtml: item.html, error: e.message });
      }
    }
    setResults(all);
    addLog("Done — " + all.reduce((s, r) => s + r.issues.length, 0) + " issues", COLORS.accent);
    setStep("done");
  }

  function applyFix(path, id) {
    setResults(prev => prev.map(item => {
      if (item.path !== path) return item;
      const iss = item.issues.find(x => x.id === id);
      if (!iss || iss.fixed) return item;
      const r = applyFixToHtml(item.fixedHtml, iss.flagged, iss.context_before, iss.context_after, iss.suggestion);
      return { ...item, fixedHtml: r.applied ? r.html : item.fixedHtml,
        issues: item.issues.map(x => x.id === id ? { ...x, fixed: r.applied, fixFailed: r.applied ? null : r.reason } : x) };
    }));
  }
  function revertAll(path) {
    setResults(prev => prev.map(item => {
      if (item.path !== path) return item;
      let h = item.html;
      const issues = item.issues.map(iss => {
        if (iss.tier === "auto" && iss.suggestion != null) {
          const r = applyFixToHtml(h, iss.flagged, iss.context_before, iss.context_after, iss.suggestion);
          if (r.applied) { h = r.html; return { ...iss, fixed: true, fixFailed: null }; }
        }
        return { ...iss, fixed: false, fixFailed: null };
      });
      return { ...item, fixedHtml: h, issues };
    }));
  }
  function fixAll(path) {
    setResults(prev => prev.map(item => {
      if (item.path !== path) return item;
      let h = item.fixedHtml;
      const issues = item.issues.map(iss => {
        if (iss.fixed || iss.suggestion == null) return iss;
        const r = applyFixToHtml(h, iss.flagged, iss.context_before, iss.context_after, iss.suggestion);
        if (r.applied) h = r.html;
        return { ...iss, fixed: r.applied, fixFailed: r.applied ? null : r.reason };
      });
      return { ...item, fixedHtml: h, issues };
    }));
  }

  async function downloadZip() {
    if (!window.JSZip) return;
    const zip = new window.JSZip();
    results.forEach(item => zip.file(item.path, item.fixedHtml));
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "fixed_course_" + (courseId || "export") + ".zip";
    document.body.appendChild(a); a.click(); a.remove();
  }

  const totalIssues = results.reduce((s, r) => s + r.issues.length, 0);
  const totalFixed = results.reduce((s, r) => s + r.issues.filter(i => i.fixed).length, 0);
  const cleanCount = results.filter(r => r.issues.length === 0).length;
  const catCounts = {};
  results.forEach(r => r.issues.forEach(i => { catCounts[i.category] = (catCounts[i.category] || 0) + 1; }));
  const visible = filter === "all" ? results.filter(r => r.issues.length) : results.filter(r => r.issues.some(i => i.category === filter));
  const pct = progress.total ? Math.round((progress.current / progress.total) * 100) : 0;

  const card = { background: COLORS.surface, border: "1px solid " + COLORS.border, borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };
  const mono = "'IBM Plex Mono', monospace";

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "48px 24px 80px" }}>

        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: COLORS.accentLight,
            border: "1px solid rgba(26,127,69,0.2)", color: COLORS.accent, fontFamily: mono, fontSize: 11,
            letterSpacing: "0.08em", textTransform: "uppercase", padding: "5px 12px", borderRadius: 20, marginBottom: 16 }}>
            <span style={{ width: 6, height: 6, background: COLORS.accent, borderRadius: "50%" }} />
            Polish v2 | by SRM
          </div>
          <h1 style={{ fontSize: 36, fontWeight: 600, letterSpacing: "-0.02em", color: COLORS.text, lineHeight: 1.2, margin: 0 }}>
            <span style={{ color: COLORS.accent }}>Polish</span>
          </h1>
          <p style={{ color: COLORS.muted, fontSize: 14, marginTop: 8, lineHeight: 1.6 }}>
            Mechanical, AI-tell, and house-style checks run in your browser — no text leaves.
            The optional editorial pass sends prose only (never code, math, or links) to Claude.
          </p>
        </div>

        {(courseTitle || courseId) && (
          <div style={{ ...card, padding: "14px 18px", marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ fontSize: 22 }}>📚</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.mutedLight, fontFamily: mono }}>Course</div>
              {courseTitle && <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{courseTitle}</div>}
              {courseId && <div style={{ fontSize: 12, color: COLORS.muted, fontFamily: mono }}>ID {courseId}</div>}
            </div>
          </div>
        )}

        {step === "setup" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ ...card, padding: "22px 26px" }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.text, marginBottom: 14 }}>Gather ZIP</div>
              <div
                onClick={() => zipReady && fileRef.current?.click()}
                onDragOver={e => { e.preventDefault(); if (zipReady) e.currentTarget.style.borderColor = COLORS.accent; }}
                onDragLeave={e => { e.currentTarget.style.borderColor = COLORS.border; }}
                onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = COLORS.border; if (zipReady && e.dataTransfer.files[0]) handleZip(e.dataTransfer.files[0]); }}
                style={{ background: COLORS.surface2, border: "2px dashed " + COLORS.border, borderRadius: 10, padding: "32px 24px",
                  textAlign: "center", cursor: zipReady ? "pointer" : "wait", opacity: zipReady ? 1 : 0.6 }}>
                <input ref={fileRef} type="file" accept=".zip" style={{ display: "none" }} onChange={e => e.target.files[0] && handleZip(e.target.files[0])} />
                {zipName ? (
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.text, marginBottom: 4 }}>{zipName}</div>
                    <div style={{ fontSize: 12, color: COLORS.accent, fontFamily: mono }}>{items.length} items ready</div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>📁</div>
                    <div style={{ fontSize: 13, color: COLORS.muted }}>{zipReady ? "Drop a Gather ZIP or click to browse" : "Loading ZIP library…"}</div>
                  </div>
                )}
              </div>

              {hasStudentContent && (
                <div style={{ marginTop: 12, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#92660a", lineHeight: 1.5 }}>
                  ⚠ This ZIP includes Discussions, which may contain student-authored replies. If you run the editorial
                  pass through a shared key (not your own), confirm those files hold prompts only — student content
                  through a third-party key is the FERPA line.
                </div>
              )}
            </div>

            {/* AI toggle */}
            <div style={{ ...card, padding: "16px 22px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
                <input type="checkbox" checked={useAI} onChange={e => setUseAI(e.target.checked)} style={{ width: 16, height: 16, accentColor: COLORS.accent }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>Editorial pass (AI)</div>
                  <div style={{ fontSize: 12, color: COLORS.mutedLight }}>Grammar, usage, contextual spelling, clarity. Prose only.</div>
                </div>
                {deploy.mode === "srm" && (
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", padding: "3px 9px", borderRadius: 12, background: COLORS.accentLight, color: COLORS.accent, fontFamily: mono }}>SRM</span>
                )}
              </label>

              {deploy.mode === "client" && (
                <>
                  <div style={{ marginTop: 12, fontSize: 12, color: COLORS.mutedLight, cursor: "pointer" }} onClick={() => setShowAdvanced(s => !s)}>
                    {showAdvanced ? "▾" : "▸"} Your Anthropic key
                  </div>
                  {showAdvanced && (
                    <div style={{ marginTop: 10 }}>
                      <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-ant-…"
                        style={{ width: "100%", padding: "10px 14px", fontSize: 13, fontFamily: mono, border: "1px solid " + COLORS.border, borderRadius: 8, background: COLORS.surface2, color: COLORS.text, outline: "none", boxSizing: "border-box" }} />
                      <p style={{ fontSize: 11, color: COLORS.mutedLight, marginTop: 6 }}>Your key is used directly from this browser and never sent to SRM.</p>
                    </div>
                  )}
                </>
              )}
              {deploy.mode === "srm" && (
                <p style={{ marginTop: 10, fontSize: 11, color: COLORS.mutedLight }}>The editorial pass runs on SRM's account through the secure proxy. No key needed.</p>
              )}
            </div>

            {log.length > 0 && (
              <div style={{ background: "#010409", border: "1px solid #30363d", borderRadius: 8, padding: 14, maxHeight: 150, overflowY: "auto", fontFamily: mono, fontSize: 11, lineHeight: 1.8 }}>
                {log.map((l, i) => <div key={i} style={{ color: l.color }}>{l.msg}</div>)}
              </div>
            )}
            {error && <div style={{ background: COLORS.redBg, border: "1px solid " + COLORS.redBorder, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: COLORS.red }}>{error}</div>}

            <button onClick={runCheck} disabled={!items.length}
              style={{ background: !items.length ? COLORS.border : "linear-gradient(135deg,#1a7f45,#22a35a)", color: "#fff", border: "none",
                borderRadius: 10, padding: "14px 24px", fontSize: 15, fontWeight: 600, cursor: !items.length ? "not-allowed" : "pointer",
                boxShadow: !items.length ? "none" : "0 4px 16px rgba(26,127,69,0.25)" }}>
              ✏️ Check {items.length} Item{items.length !== 1 ? "s" : ""}
            </button>
          </div>
        )}

        {step === "checking" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ ...card, padding: "22px 26px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>Checking… {progress.current}/{progress.total}</span>
                <button onClick={() => (abortRef.current = true)} style={{ background: "none", border: "1px solid " + COLORS.border, borderRadius: 6, padding: "4px 12px", fontSize: 12, color: COLORS.muted, cursor: "pointer" }}>Stop</button>
              </div>
              <div style={{ background: COLORS.surface2, borderRadius: 4, height: 6, marginBottom: 10 }}>
                <div style={{ background: "linear-gradient(90deg,#1a7f45,#22a35a)", height: "100%", borderRadius: 4, width: pct + "%", transition: "width 0.3s" }} />
              </div>
              <div style={{ fontSize: 12, color: COLORS.mutedLight, fontFamily: mono, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{progress.label}</div>
            </div>
            <div style={{ background: "#010409", border: "1px solid #30363d", borderRadius: 8, padding: 14, maxHeight: 280, overflowY: "auto", fontFamily: mono, fontSize: 11, lineHeight: 1.8 }}>
              {log.map((l, i) => <div key={i} style={{ color: l.color }}>{l.msg}</div>)}
            </div>
          </div>
        )}

        {step === "done" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div style={{ ...card, padding: "12px 18px", flex: "1 1 80px" }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: totalIssues ? COLORS.red : COLORS.accent }}>{totalIssues}</div>
                <div style={{ fontSize: 12, color: COLORS.muted }}>Issues</div>
              </div>
              <div style={{ ...card, padding: "12px 18px", flex: "1 1 80px" }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: COLORS.accent }}>{totalFixed}</div>
                <div style={{ fontSize: 12, color: COLORS.muted }}>Fixed</div>
              </div>
              <div style={{ ...card, padding: "12px 18px", flex: "1 1 80px" }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: COLORS.accent }}>{cleanCount}</div>
                <div style={{ fontSize: 12, color: COLORS.muted }}>Clean</div>
              </div>
              {Object.entries(catCounts).map(([c, n]) => (
                <div key={c} style={{ ...card, background: catMeta(c).bg, border: "1px solid " + catMeta(c).border, padding: "12px 18px", flex: "1 1 80px" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: catMeta(c).color }}>{n}</div>
                  <div style={{ fontSize: 12, color: COLORS.muted }}>{catMeta(c).label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => setFilter("all")} style={{ padding: "5px 14px", fontSize: 12, fontWeight: filter === "all" ? 700 : 500,
                background: filter === "all" ? COLORS.text : "transparent", color: filter === "all" ? "#fff" : COLORS.muted,
                border: filter === "all" ? "none" : "1px solid " + COLORS.border, borderRadius: 16, cursor: "pointer" }}>All ({totalIssues})</button>
              {Object.entries(catCounts).map(([c, n]) => {
                const m = catMeta(c), on = filter === c;
                return <button key={c} onClick={() => setFilter(on ? "all" : c)} style={{ padding: "5px 14px", fontSize: 12, fontWeight: on ? 700 : 500,
                  background: on ? m.color : "transparent", color: on ? "#fff" : m.color, border: on ? "none" : "1px solid " + m.border, borderRadius: 16, cursor: "pointer" }}>{m.label} ({n})</button>;
              })}
            </div>

            {visible.map(item => {
              const issues = (filter === "all" ? item.issues : item.issues.filter(i => i.category === filter))
                .slice().sort((a, b) => ({ auto: 0, suggest: 1, flag: 2 }[a.tier] - { auto: 0, suggest: 1, flag: 2 }[b.tier]));
              const open = expanded[item.path] !== false;
              const pending = item.issues.filter(i => !i.fixed && i.suggestion != null).length;
              const fixedN = item.issues.filter(i => i.fixed).length;
              return (
                <div key={item.path} style={{ ...card, padding: 0, overflow: "hidden" }}>
                  <div style={{ padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: open && issues.length ? "1px solid " + COLORS.borderLight : "none" }}>
                    <div onClick={() => setExpanded(p => ({ ...p, [item.path]: !open }))} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", flex: 1, minWidth: 0 }}>
                      <span>{item.icon}</span>
                      <span style={{ fontWeight: 600, fontSize: 14, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</span>
                      <span style={{ fontSize: 11, fontFamily: mono, color: COLORS.mutedLight }}>{item.folder}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {fixedN > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 10px", borderRadius: 12, background: COLORS.accentLight, color: COLORS.accent }}>{fixedN} fixed</span>}
                      {pending > 0 && <button onClick={() => fixAll(item.path)} style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 6, background: COLORS.accent, color: "#fff", border: "none", cursor: "pointer" }}>Fix {pending}</button>}
                      {fixedN > 0 && <button onClick={() => revertAll(item.path)} style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 6, background: "transparent", color: COLORS.muted, border: "1px solid " + COLORS.border, cursor: "pointer" }}>Reset</button>}
                      <span onClick={() => setExpanded(p => ({ ...p, [item.path]: !open }))} style={{ color: COLORS.mutedLight, fontSize: 14, cursor: "pointer" }}>{open ? "▾" : "▸"}</span>
                    </div>
                  </div>
                  {open && issues.map(iss => {
                    const m = catMeta(iss.category), t = TIER[iss.tier] || TIER.suggest;
                    return (
                      <div key={iss.id} style={{ padding: "10px 18px", display: "flex", alignItems: "flex-start", gap: 10, borderBottom: "1px solid " + COLORS.borderLight, fontSize: 13, background: iss.fixed ? COLORS.accentLight : "transparent", opacity: iss.fixed ? 0.7 : 1 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, color: "#fff", background: t.color, whiteSpace: "nowrap", marginTop: 3 }}>{t.label}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", padding: "2px 8px", borderRadius: 10, color: "#fff", background: m.color, whiteSpace: "nowrap", marginTop: 2 }}>{m.label}</span>
                        <div style={{ flex: 1, lineHeight: 1.6, minWidth: 0 }}>
                          <span style={{ fontWeight: 600, color: m.color, textDecoration: iss.fixed ? "line-through" : "none" }}>"{iss.flagged}"</span>
                          <span style={{ color: COLORS.muted }}> — {iss.explanation}</span>
                          {iss.suggestion != null && <span style={{ color: COLORS.accent, fontStyle: "italic" }}>{" → "}{iss.suggestion || "(remove)"}</span>}
                          {iss.fixFailed && <div style={{ fontSize: 11, color: COLORS.red, marginTop: 4, fontStyle: "italic" }}>⚠ {iss.fixFailed}</div>}
                        </div>
                        {iss.suggestion != null && (iss.fixed
                          ? <span style={{ fontSize: 11, color: COLORS.accent, marginTop: 2 }}>✓</span>
                          : <button onClick={() => applyFix(item.path, iss.id)} style={{ fontSize: 11, fontWeight: 600, padding: "4px 12px", borderRadius: 6, background: COLORS.accent, color: "#fff", border: "none", cursor: "pointer", marginTop: 1 }}>Fix</button>)}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {cleanCount > 0 && <div style={{ ...card, padding: "12px 18px", fontSize: 13, color: COLORS.muted }}>{cleanCount} clean item{cleanCount !== 1 ? "s" : ""} not shown</div>}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={downloadZip} disabled={!totalFixed} style={{ flex: "2 1 220px", background: !totalFixed ? COLORS.border : "linear-gradient(135deg,#1a7f45,#22a35a)", color: "#fff", border: "none", borderRadius: 10, padding: "12px 20px", fontSize: 14, fontWeight: 600, cursor: !totalFixed ? "not-allowed" : "pointer" }}>
                📦 Download Fixed ZIP {totalFixed > 0 && "(" + totalFixed + ")"}
              </button>
              <button onClick={() => { setStep("setup"); setResults([]); setProgress({ current: 0, total: 0, label: "" }); setExpanded({}); setFilter("all"); }}
                style={{ flex: "1 1 140px", ...card, padding: "12px 20px", fontSize: 14, fontWeight: 600, color: COLORS.text, cursor: "pointer" }}>Check Another</button>
            </div>

            <div style={{ marginTop: 24, paddingTop: 18, borderTop: "1px solid " + COLORS.border, fontSize: 11, color: COLORS.mutedLight, fontFamily: mono, lineHeight: 1.8 }}>
              ✏️ Polish v2 · by Six Red Marbles · deterministic + Claude<br />
              © 2026 Six Red Marbles. All rights reserved.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
