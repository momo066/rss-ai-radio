import { useState, useEffect, useRef, useCallback } from "react";

const DEFAULT_FEEDS = [
  { id: 1, name: "NHK ニュース", url: "https://www3.nhk.or.jp/rss/news/cat0.xml", active: true },
  { id: 2, name: "TechCrunch Japan", url: "https://jp.techcrunch.com/feed/", active: true },
  { id: 3, name: "Gigazine", url: "https://gigazine.net/news/rss_2.0/", active: false },
];

const CORS_PROXY = "https://api.allorigins.win/get?url=";
const GEMINI_API_KEY_ENV = import.meta.env.VITE_GEMINI_API_KEY || "";

// ============================================================
// Gemini API（無料枠：1日1500リクエスト）
// ============================================================
async function summarizeWithGemini(articles, apiKey) {
  const articleText = articles
    .slice(0, 5)
    .map((a, i) => `【記事${i + 1}】${a.title}\n${a.description || ""}`)
    .join("\n\n");

  const prompt = `あなたはラジオDJです。以下のニュース記事を、ラジオで読み上げるような自然な日本語のスクリプトに要約してください。
各記事を30秒程度で読めるように、聞きやすい口語体で書いてください。
冒頭に「本日のニュースをお届けします」などの導入を入れ、最後に締めの言葉を入れてください。
全体で3〜4分程度で読めるようにしてください。

${articleText}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1200 },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || res.statusText);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "要約の生成に失敗しました。";
}

// ============================================================
// RSS パース
// ============================================================
async function fetchRSS(feedUrl) {
  const res = await fetch(`${CORS_PROXY}${encodeURIComponent(feedUrl)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const xml = new DOMParser().parseFromString(json.contents, "text/xml");
  return Array.from(xml.querySelectorAll("item"))
    .slice(0, 10)
    .map((item) => ({
      title: item.querySelector("title")?.textContent || "",
      description: item.querySelector("description")?.textContent?.replace(/<[^>]*>/g, "").slice(0, 200) || "",
      link: item.querySelector("link")?.textContent || "",
    }));
}

// ============================================================
// TTS
// ============================================================
function speakText(text, { onEnd, onBoundary, onError } = {}) {
  const synth = window.speechSynthesis;
  synth.cancel();
  const doSpeak = () => {
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = "ja-JP";
    utt.rate = 1.0;
    const voices = synth.getVoices();
    const ja = voices.find((v) => v.lang === "ja-JP" || v.lang.startsWith("ja"));
    if (ja) utt.voice = ja;
    utt.onend = () => onEnd?.();
    utt.onerror = (e) => onError?.(e);
    if (onBoundary) utt.onboundary = onBoundary;
    synth.speak(utt);
  };
  const voices = synth.getVoices();
  if (voices.length > 0) { doSpeak(); }
  else { synth.onvoiceschanged = () => { synth.onvoiceschanged = null; doSpeak(); }; setTimeout(doSpeak, 500); }
}

function statusColor(s) {
  return { idle:"#555", fetching:"#f0a500", summarizing:"#a78bfa", ready:"#00e5a0", playing:"#00e5a0", paused:"#f0a500" }[s] || "#555";
}

// ============================================================
// メインコンポーネント
// ============================================================
export default function RSSRadio() {
  const [feeds, setFeeds] = useState(() => {
    try { return JSON.parse(localStorage.getItem("rss_feeds")) || DEFAULT_FEEDS; }
    catch { return DEFAULT_FEEDS; }
  });
  const [newFeedName, setNewFeedName] = useState("");
  const [newFeedUrl, setNewFeedUrl] = useState("");
  const [articles, setArticles] = useState([]);
  const [script, setScript] = useState("");
  const [displayedText, setDisplayedText] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [showAddFeed, setShowAddFeed] = useState(false);
  const [activeTab, setActiveTab] = useState("radio");
  const [waveActive, setWaveActive] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("gemini_api_key") || "");
  const [showApiKey, setShowApiKey] = useState(false);
  const scriptRef = useRef("");

  useEffect(() => { localStorage.setItem("rss_feeds", JSON.stringify(feeds)); }, [feeds]);
  useEffect(() => { window.speechSynthesis.getVoices(); }, []);

  const handleSaveApiKey = () => {
    localStorage.setItem("gemini_api_key", apiKey);
    setShowApiKey(false);
    setError("");
  };

  const handleGenerate = useCallback(async () => {
    const activeFeeds = feeds.filter((f) => f.active);
    if (activeFeeds.length === 0) { setError("有効なフィードを選択してください"); return; }

    const key = localStorage.getItem("gemini_api_key") || GEMINI_API_KEY_ENV;
    if (!key) { setError("Gemini APIキーを設定してください（右上の⚙️）"); setShowApiKey(true); return; }

    setError(""); setStatus("fetching"); setScript(""); setDisplayedText(""); setProgress(0); setArticles([]);

    try {
      const allArticles = [];
      for (const feed of activeFeeds) {
        try {
          const items = await fetchRSS(feed.url);
          allArticles.push(...items.map((i) => ({ ...i, source: feed.name })));
        } catch (e) { console.warn(`Feed failed: ${feed.name}`, e); }
      }
      setArticles(allArticles);

      if (allArticles.length === 0) { setError("記事を取得できませんでした。"); setStatus("idle"); return; }

      setStatus("summarizing");
      const summary = await summarizeWithGemini(allArticles, key);
      scriptRef.current = summary;
      setScript(summary);
      setStatus("ready");
    } catch (e) {
      setError(`エラー: ${e.message}`);
      setStatus("idle");
    }
  }, [feeds]);

  const handlePlay = useCallback(() => {
    if (!scriptRef.current) return;
    setStatus("playing"); setWaveActive(true); setDisplayedText(""); setProgress(0);
    speakText(scriptRef.current, {
      onEnd: () => { setStatus("ready"); setWaveActive(false); setProgress(100); },
      onError: (e) => { setError(`音声エラー: ${e.error}`); setStatus("ready"); setWaveActive(false); },
      onBoundary: (e) => {
        if (e.charIndex !== undefined) {
          setProgress(Math.min(100, Math.round((e.charIndex / scriptRef.current.length) * 100)));
          setDisplayedText(scriptRef.current.slice(0, e.charIndex + (e.charLength || 1)));
        }
      },
    });
  }, []);

  const handlePauseResume = useCallback(() => {
    if (status === "playing") { window.speechSynthesis.pause(); setStatus("paused"); setWaveActive(false); }
    else if (status === "paused") { window.speechSynthesis.resume(); setStatus("playing"); setWaveActive(true); }
  }, [status]);

  const handleStop = useCallback(() => {
    window.speechSynthesis.cancel(); setStatus("ready"); setWaveActive(false); setProgress(0); setDisplayedText("");
  }, []);

  const handleAddFeed = () => {
    if (!newFeedName.trim() || !newFeedUrl.trim()) return;
    setFeeds((p) => [...p, { id: Date.now(), name: newFeedName.trim(), url: newFeedUrl.trim(), active: true }]);
    setNewFeedName(""); setNewFeedUrl(""); setShowAddFeed(false);
  };

  const statusLabel = { idle:"待機中", fetching:"RSS取得中...", summarizing:"AI要約中...", ready:"準備完了", playing:"放送中", paused:"一時停止" };
  const isLoading = status === "fetching" || status === "summarizing";

  return (
    <div style={s.root}>
      <div style={s.bgGlow} />

      {/* APIキー設定モーダル */}
      {showApiKey && (
        <div style={s.modal}>
          <div style={s.modalBox}>
            <div style={s.modalTitle}>🔑 Gemini APIキー設定</div>
            <div style={s.modalDesc}>
              Google AI Studio（aistudio.google.com）で取得したAPIキーを入力してください。{"\n"}
              無料で1日1,500回まで使えます。
            </div>
            <input
              style={s.input}
              type="password"
              placeholder="AIzaSy..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <div style={{ display:"flex", gap:"10px", marginTop:"8px" }}>
              <button style={s.btnPrimary} onClick={handleSaveApiKey}>保存</button>
              <button style={s.btnSecondary} onClick={() => setShowApiKey(false)}>閉じる</button>
            </div>
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" style={s.link}>
              → APIキーを取得する（無料）
            </a>
          </div>
        </div>
      )}

      {/* ヘッダー */}
      <header style={s.header}>
        <div style={s.logoArea}>
          <span style={{ fontSize:"26px" }}>📻</span>
          <div>
            <div style={s.logoTitle}>AI RADIO</div>
            <div style={s.logoSub}>RSS × Gemini Broadcasting</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
          <div style={s.statusBadge}>
            <span style={{ ...s.statusDot, background: statusColor(status) }} />
            {statusLabel[status]}
          </div>
          <button style={s.btnIcon} onClick={() => setShowApiKey(true)} title="APIキー設定">⚙️</button>
        </div>
      </header>

      {/* タブ */}
      <nav style={s.tabs}>
        {[["radio","📻 ラジオ"],["feeds","📡 フィード"],["articles","📰 記事"]].map(([key, label]) => (
          <button key={key} style={{ ...s.tab, ...(activeTab===key ? s.tabActive : {}) }} onClick={() => setActiveTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      <main style={s.main}>

        {/* ===== ラジオ ===== */}
        {activeTab === "radio" && (
          <div style={s.panel}>
            <div style={s.visualizer}>
              {Array.from({ length: 28 }).map((_, i) => (
                <div key={i} style={{
                  width:"7px", borderRadius:"3px 3px 0 0",
                  background:`hsl(${160 + i*4}, 75%, 52%)`,
                  height: waveActive ? `${25 + Math.abs(Math.sin(i*0.7))*55}%` : "10%",
                  transition: waveActive ? `height ${0.3+(i%5)*0.08}s ease-in-out` : "height 0.5s ease",
                  animation: waveActive ? `waveBar ${0.8+(i%7)*0.15}s ease-in-out infinite alternate` : "none",
                }} />
              ))}
            </div>

            <button
              style={{ ...s.btnPrimary, opacity:isLoading?0.65:1, width:"100%", maxWidth:"360px", alignSelf:"center" }}
              onClick={handleGenerate}
              disabled={isLoading}
            >
              {isLoading ? <><span style={s.spinner}/>{statusLabel[status]}</> : "🎙️ 放送を生成"}
            </button>

            {(status==="ready"||status==="playing"||status==="paused") && (
              <>
                <div style={s.playerRow}>
                  <button style={s.btnCtrl} onClick={handlePlay} title="最初から再生">⏮</button>
                  <button style={{ ...s.btnCtrlLarge, ...(status==="playing"?s.btnCtrlActive:{}) }} onClick={handlePauseResume}>
                    {status==="playing" ? "⏸" : "▶"}
                  </button>
                  <button style={s.btnCtrl} onClick={handleStop}>⏹</button>
                </div>
                <div style={s.progressWrap}>
                  <div style={s.progressTrack}>
                    <div style={{ ...s.progressFill, width:`${progress}%` }} />
                  </div>
                  <span style={s.progressPct}>{progress}%</span>
                </div>
              </>
            )}

            {script && (
              <div style={s.scriptBox}>
                <div style={s.scriptLabel}>📝 放送スクリプト</div>
                <div style={s.scriptText}>
                  {(status==="playing"||status==="paused") && displayedText ? displayedText : script}
                </div>
              </div>
            )}

            {error && <div style={s.errorBox}>⚠️ {error}</div>}
          </div>
        )}

        {/* ===== フィード ===== */}
        {activeTab === "feeds" && (
          <div style={s.panel}>
            <div style={s.rowBetween}>
              <span style={s.sectionTitle}>登録フィード ({feeds.length}件)</span>
              <button style={s.btnSecondary} onClick={() => setShowAddFeed(!showAddFeed)}>
                {showAddFeed ? "✕ 閉じる" : "+ 追加"}
              </button>
            </div>

            {showAddFeed && (
              <div style={s.addForm}>
                <input style={s.input} placeholder="フィード名" value={newFeedName} onChange={(e) => setNewFeedName(e.target.value)} />
                <input style={s.input} placeholder="RSS URL (https://...)" value={newFeedUrl} onChange={(e) => setNewFeedUrl(e.target.value)} />
                <button style={s.btnPrimary} onClick={handleAddFeed}>追加する</button>
              </div>
            )}

            <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
              {feeds.map((feed) => (
                <div key={feed.id} style={s.feedItem}>
                  <button style={{ ...s.toggleBtn, background:feed.active?"#00e5a0":"#333" }} onClick={() => setFeeds((p) => p.map((f) => f.id===feed.id?{...f,active:!f.active}:f))}>
                    {feed.active?"ON":"OFF"}
                  </button>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={s.feedName}>{feed.name}</div>
                    <div style={s.feedUrl}>{feed.url}</div>
                  </div>
                  <button style={s.btnDelete} onClick={() => setFeeds((p) => p.filter((f) => f.id!==feed.id))}>✕</button>
                </div>
              ))}
            </div>
            <div style={s.tip}>💡 ONにしたフィードのみ放送に含まれます</div>
          </div>
        )}

        {/* ===== 記事 ===== */}
        {activeTab === "articles" && (
          <div style={s.panel}>
            {articles.length === 0 ? (
              <div style={s.empty}>
                <div style={{ fontSize:"48px", opacity:0.3 }}>📰</div>
                <div style={{ color:"#555", fontSize:"14px" }}>「放送を生成」を押すと記事が表示されます</div>
              </div>
            ) : (
              <>
                <div style={s.sectionTitle}>{articles.length}件の記事を取得</div>
                {articles.map((a, i) => (
                  <div key={i} style={s.articleCard}>
                    <div style={s.articleSource}>{a.source}</div>
                    <div style={s.articleTitle}>{a.title}</div>
                    <div style={s.articleDesc}>{a.description}</div>
                    {a.link && <a href={a.link} target="_blank" rel="noopener noreferrer" style={s.articleLink}>続きを読む →</a>}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </main>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Noto+Sans+JP:wght@300;400;700&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; background: #0a0a0f; }
        input::placeholder { color: #444; }
        input:focus { outline: none; border-color: rgba(0,229,160,0.4) !important; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        @keyframes waveBar { from { transform: scaleY(0.5); } to { transform: scaleY(1); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
    </div>
  );
}

const s = {
  root: { minHeight:"100vh", background:"#0a0a0f", color:"#e8e8f0", fontFamily:"'Noto Sans JP', sans-serif", position:"relative", overflowX:"hidden" },
  bgGlow: { position:"fixed", top:"-20%", left:"50%", transform:"translateX(-50%)", width:"500px", height:"500px", background:"radial-gradient(circle, rgba(0,229,160,0.05) 0%, transparent 70%)", pointerEvents:"none" },
  modal: { position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:"20px" },
  modalBox: { background:"#111118", borderRadius:"16px", border:"1px solid rgba(255,255,255,0.1)", padding:"24px", width:"100%", maxWidth:"420px", display:"flex", flexDirection:"column", gap:"14px", animation:"fadeUp 0.2s ease" },
  modalTitle: { fontSize:"16px", fontWeight:"700", color:"#00e5a0" },
  modalDesc: { fontSize:"12px", color:"#777", lineHeight:"1.7", whiteSpace:"pre-wrap" },
  link: { fontSize:"12px", color:"#00b4d8", textDecoration:"none" },
  header: { position:"relative", zIndex:10, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"18px 20px 14px", borderBottom:"1px solid rgba(255,255,255,0.07)" },
  logoArea: { display:"flex", alignItems:"center", gap:"12px" },
  logoTitle: { fontFamily:"'Space Mono', monospace", fontSize:"18px", fontWeight:"700", color:"#00e5a0", letterSpacing:"3px" },
  logoSub: { fontSize:"9px", color:"#555", letterSpacing:"1px", marginTop:"2px" },
  statusBadge: { display:"flex", alignItems:"center", gap:"6px", fontSize:"11px", color:"#888", fontFamily:"'Space Mono', monospace", background:"rgba(255,255,255,0.04)", padding:"5px 10px", borderRadius:"20px", border:"1px solid rgba(255,255,255,0.07)" },
  statusDot: { width:"7px", height:"7px", borderRadius:"50%", animation:"pulse 2s ease-in-out infinite" },
  btnIcon: { background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"8px", width:"36px", height:"36px", cursor:"pointer", fontSize:"16px", display:"flex", alignItems:"center", justifyContent:"center" },
  tabs: { position:"relative", zIndex:10, display:"flex", padding:"0 20px", borderBottom:"1px solid rgba(255,255,255,0.06)" },
  tab: { background:"none", border:"none", borderBottom:"2px solid transparent", color:"#555", fontSize:"13px", padding:"12px 18px", cursor:"pointer", transition:"all 0.2s", fontFamily:"'Noto Sans JP', sans-serif" },
  tabActive: { color:"#00e5a0", borderBottom:"2px solid #00e5a0" },
  main: { position:"relative", zIndex:10, padding:"20px", maxWidth:"680px", margin:"0 auto" },
  panel: { display:"flex", flexDirection:"column", gap:"16px", animation:"fadeUp 0.25s ease" },
  visualizer: { display:"flex", alignItems:"flex-end", justifyContent:"center", gap:"4px", height:"72px", background:"rgba(0,0,0,0.35)", borderRadius:"12px", padding:"10px 16px", border:"1px solid rgba(255,255,255,0.05)", overflow:"hidden" },
  btnPrimary: { background:"linear-gradient(135deg, #00e5a0, #00b4d8)", border:"none", borderRadius:"10px", color:"#0a0a0f", fontSize:"15px", fontWeight:"700", padding:"14px 28px", cursor:"pointer", fontFamily:"'Noto Sans JP', sans-serif", display:"flex", alignItems:"center", justifyContent:"center", gap:"8px", transition:"opacity 0.2s" },
  btnSecondary: { background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.12)", borderRadius:"8px", color:"#ccc", fontSize:"12px", padding:"7px 14px", cursor:"pointer", fontFamily:"'Noto Sans JP', sans-serif" },
  playerRow: { display:"flex", alignItems:"center", justifyContent:"center", gap:"14px" },
  btnCtrl: { background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"50%", width:"46px", height:"46px", color:"#ddd", fontSize:"16px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" },
  btnCtrlLarge: { background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.12)", borderRadius:"50%", width:"60px", height:"60px", color:"#e8e8f0", fontSize:"22px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.2s" },
  btnCtrlActive: { background:"rgba(0,229,160,0.15)", borderColor:"#00e5a0", color:"#00e5a0" },
  progressWrap: { display:"flex", alignItems:"center", gap:"10px" },
  progressTrack: { flex:1, height:"3px", background:"rgba(255,255,255,0.08)", borderRadius:"2px", overflow:"hidden" },
  progressFill: { height:"100%", background:"linear-gradient(90deg, #00e5a0, #00b4d8)", transition:"width 0.3s ease" },
  progressPct: { fontFamily:"'Space Mono', monospace", fontSize:"10px", color:"#555", minWidth:"32px", textAlign:"right" },
  scriptBox: { background:"rgba(0,0,0,0.3)", borderRadius:"12px", padding:"18px", border:"1px solid rgba(0,229,160,0.12)" },
  scriptLabel: { fontSize:"10px", color:"#00e5a0", letterSpacing:"1px", fontFamily:"'Space Mono', monospace", marginBottom:"10px" },
  scriptText: { fontSize:"13px", lineHeight:"1.85", color:"#bbb", whiteSpace:"pre-wrap", maxHeight:"280px", overflowY:"auto" },
  spinner: { display:"inline-block", width:"13px", height:"13px", border:"2px solid rgba(0,0,0,0.25)", borderTopColor:"#0a0a0f", borderRadius:"50%", animation:"spin 0.7s linear infinite" },
  errorBox: { background:"rgba(255,80,80,0.08)", border:"1px solid rgba(255,80,80,0.25)", borderRadius:"8px", padding:"12px 14px", fontSize:"13px", color:"#ff9090", lineHeight:"1.6", whiteSpace:"pre-wrap" },
  rowBetween: { display:"flex", justifyContent:"space-between", alignItems:"center" },
  sectionTitle: { fontFamily:"'Space Mono', monospace", fontSize:"11px", color:"#666", letterSpacing:"1px" },
  addForm: { background:"rgba(0,0,0,0.25)", borderRadius:"10px", padding:"14px", border:"1px solid rgba(255,255,255,0.07)", display:"flex", flexDirection:"column", gap:"10px" },
  input: { background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"6px", color:"#e8e8f0", fontSize:"13px", padding:"10px 13px", fontFamily:"'Noto Sans JP', sans-serif", width:"100%" },
  feedItem: { display:"flex", alignItems:"center", gap:"12px", background:"rgba(255,255,255,0.025)", borderRadius:"10px", padding:"12px 14px", border:"1px solid rgba(255,255,255,0.05)" },
  toggleBtn: { border:"none", borderRadius:"10px", color:"#0a0a0f", fontSize:"9px", fontWeight:"700", padding:"4px 9px", cursor:"pointer", fontFamily:"'Space Mono', monospace", minWidth:"38px", transition:"background 0.2s" },
  feedName: { fontSize:"13px", fontWeight:"700", marginBottom:"2px" },
  feedUrl: { fontSize:"10px", color:"#444", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" },
  btnDelete: { background:"none", border:"none", color:"#444", fontSize:"14px", cursor:"pointer", padding:"4px", flexShrink:0 },
  tip: { fontSize:"11px", color:"#444", lineHeight:"1.6" },
  empty: { display:"flex", flexDirection:"column", alignItems:"center", gap:"12px", padding:"60px 20px" },
  articleCard: { background:"rgba(255,255,255,0.025)", borderRadius:"10px", padding:"14px", border:"1px solid rgba(255,255,255,0.05)" },
  articleSource: { fontSize:"9px", color:"#00e5a0", fontFamily:"'Space Mono', monospace", letterSpacing:"1px", marginBottom:"5px" },
  articleTitle: { fontSize:"13px", fontWeight:"700", marginBottom:"5px", lineHeight:"1.5" },
  articleDesc: { fontSize:"11px", color:"#666", lineHeight:"1.65", marginBottom:"7px" },
  articleLink: { fontSize:"11px", color:"#00b4d8", textDecoration:"none" },
};
