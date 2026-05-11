import { useState, useEffect, useRef, useCallback } from "react";

// ============================================================
// RSS AI RADIO - AIが要約して自動再生するラジオアプリ
// ============================================================

const DEFAULT_FEEDS = [
  { id: 1, name: "NHK ニュース", url: "https://www3.nhk.or.jp/rss/news/cat0.xml", active: true },
  { id: 2, name: "TechCrunch Japan", url: "https://jp.techcrunch.com/feed/", active: true },
  { id: 3, name: "Gigazine", url: "https://gigazine.net/news/rss_2.0/", active: false },
];

// ============================================================
// YOUR CLAUDE API KEY
// ※ 本番運用時は環境変数 VITE_ANTHROPIC_API_KEY に入れてください
// ============================================================
const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || "";

const CORS_PROXY = "https://api.allorigins.win/get?url=";

// ============================================================
// Claude API 呼び出し
// ============================================================
async function summarizeWithClaude(articles) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error(
      "Claude APIキーが設定されていません。\n.envファイルに VITE_ANTHROPIC_API_KEY=sk-ant-xxx を追加してください。"
    );
  }

  const articleText = articles
    .slice(0, 5)
    .map((a, i) => `【記事${i + 1}】${a.title}\n${a.description || ""}`)
    .join("\n\n");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1200,
      messages: [
        {
          role: "user",
          content: `あなたはラジオDJです。以下のニュース記事を、ラジオで読み上げるような自然な日本語のスクリプトに要約してください。
各記事を30秒程度で読めるように、聞きやすい口語体で書いてください。
冒頭に「本日のニュースをお届けします」などの導入を入れ、最後に締めの言葉を入れてください。
全体で3〜4分程度で読めるようにしてください。

${articleText}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Claude API エラー: ${err?.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || "要約の生成に失敗しました。";
}

// ============================================================
// RSS パース
// ============================================================
async function fetchRSS(feedUrl) {
  const proxyUrl = `${CORS_PROXY}${encodeURIComponent(feedUrl)}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const xmlText = json.contents;

  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "text/xml");
  const items = Array.from(xml.querySelectorAll("item")).slice(0, 10);

  return items.map((item) => ({
    title: item.querySelector("title")?.textContent || "",
    description: item
      .querySelector("description")
      ?.textContent?.replace(/<[^>]*>/g, "")
      .slice(0, 200) || "",
    link: item.querySelector("link")?.textContent || "",
    pubDate: item.querySelector("pubDate")?.textContent || "",
  }));
}

// ============================================================
// Web Speech API TTS（Android対応）
// ============================================================
function speakText(text, { onEnd, onBoundary, onError } = {}) {
  const synth = window.speechSynthesis;
  synth.cancel();

  // Androidでは voices が非同期でロードされることがある
  const doSpeak = () => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ja-JP";
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    const voices = synth.getVoices();
    const jaVoice = voices.find((v) => v.lang === "ja-JP" || v.lang.startsWith("ja"));
    if (jaVoice) utterance.voice = jaVoice;

    utterance.onend = () => onEnd?.();
    utterance.onerror = (e) => onError?.(e);
    if (onBoundary) utterance.onboundary = onBoundary;

    synth.speak(utterance);
  };

  const voices = synth.getVoices();
  if (voices.length > 0) {
    doSpeak();
  } else {
    synth.onvoiceschanged = () => {
      synth.onvoiceschanged = null;
      doSpeak();
    };
    // フォールバック（Androidで onvoiceschanged が発火しない場合）
    setTimeout(doSpeak, 500);
  }
}

// ============================================================
// ユーティリティ
// ============================================================
function statusColor(status) {
  const map = {
    idle: "#555",
    fetching: "#f0a500",
    summarizing: "#a78bfa",
    ready: "#00e5a0",
    playing: "#00e5a0",
    paused: "#f0a500",
  };
  return map[status] || "#555";
}

// ============================================================
// メインコンポーネント
// ============================================================
export default function RSSRadio() {
  const [feeds, setFeeds] = useState(() => {
    try {
      const saved = localStorage.getItem("rss_feeds");
      return saved ? JSON.parse(saved) : DEFAULT_FEEDS;
    } catch {
      return DEFAULT_FEEDS;
    }
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
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("anthropic_api_key") || "");
  const [showApiKey, setShowApiKey] = useState(false);

  const scriptRef = useRef("");

  // フィードをlocalStorageに保存
  useEffect(() => {
    localStorage.setItem("rss_feeds", JSON.stringify(feeds));
  }, [feeds]);

  // APIキー保存
  const handleSaveApiKey = () => {
    localStorage.setItem("anthropic_api_key", apiKey);
    setShowApiKey(false);
  };

  // フェッチ＋要約
  const handleGenerate = useCallback(async () => {
    const activeFeeds = feeds.filter((f) => f.active);
    if (activeFeeds.length === 0) {
      setError("有効なフィードを選択してください");
      return;
    }

    const key = localStorage.getItem("anthropic_api_key") || ANTHROPIC_API_KEY;
    if (!key) {
      setError("Claude APIキーを設定してください（設定アイコンから）");
      setShowApiKey(true);
      return;
    }

    setError("");
    setStatus("fetching");
    setScript("");
    setDisplayedText("");
    setProgress(0);
    setArticles([]);

    try {
      const allArticles = [];
      for (const feed of activeFeeds) {
        try {
          const items = await fetchRSS(feed.url);
          allArticles.push(...items.map((i) => ({ ...i, source: feed.name })));
        } catch (e) {
          console.warn(`Feed failed: ${feed.name}`, e);
        }
      }
      setArticles(allArticles);

      if (allArticles.length === 0) {
        setError("記事を取得できませんでした。フィードのURLを確認してください。");
        setStatus("idle");
        return;
      }

      setStatus("summarizing");

      // APIキーをfetch内でインジェクト
      const articleText = allArticles
        .slice(0, 5)
        .map((a, i) => `【記事${i + 1}】${a.title}\n${a.description || ""}`)
        .join("\n\n");

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1200,
          messages: [
            {
              role: "user",
              content: `あなたはラジオDJです。以下のニュース記事を、ラジオで読み上げるような自然な日本語のスクリプトに要約してください。
各記事を30秒程度で読めるように、聞きやすい口語体で書いてください。
冒頭に「本日のニュースをお届けします」などの導入を入れ、最後に締めの言葉を入れてください。
全体で3〜4分程度で読めるようにしてください。

${articleText}`,
            },
          ],
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`Claude API エラー: ${err?.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const summary = data.content?.[0]?.text || "要約の生成に失敗しました。";
      scriptRef.current = summary;
      setScript(summary);
      setStatus("ready");
    } catch (e) {
      setError(`エラー: ${e.message}`);
      setStatus("idle");
    }
  }, [feeds]);

  // 再生
  const handlePlay = useCallback(() => {
    if (!scriptRef.current) return;
    setStatus("playing");
    setWaveActive(true);
    setDisplayedText("");
    setProgress(0);

    speakText(scriptRef.current, {
      onEnd: () => {
        setStatus("ready");
        setWaveActive(false);
        setProgress(100);
      },
      onError: (e) => {
        setError(`音声エラー: ${e.error}`);
        setStatus("ready");
        setWaveActive(false);
      },
      onBoundary: (e) => {
        if (e.charIndex !== undefined) {
          const pct = Math.min(100, Math.round((e.charIndex / scriptRef.current.length) * 100));
          setProgress(pct);
          setDisplayedText(scriptRef.current.slice(0, e.charIndex + (e.charLength || 1)));
        }
      },
    });
  }, []);

  const handlePauseResume = useCallback(() => {
    if (status === "playing") {
      window.speechSynthesis.pause();
      setStatus("paused");
      setWaveActive(false);
    } else if (status === "paused") {
      window.speechSynthesis.resume();
      setStatus("playing");
      setWaveActive(true);
    }
  }, [status]);

  const handleStop = useCallback(() => {
    window.speechSynthesis.cancel();
    setStatus("ready");
    setWaveActive(false);
    setProgress(0);
    setDisplayedText("");
  }, []);

  const handleAddFeed = () => {
    if (!newFeedName.trim() || !newFeedUrl.trim()) return;
    setFeeds((prev) => [
      ...prev,
      { id: Date.now(), name: newFeedName.trim(), url: newFeedUrl.trim(), active: true },
    ]);
    setNewFeedName("");
    setNewFeedUrl("");
    setShowAddFeed(false);
  };

  const handleRemoveFeed = (id) => setFeeds((prev) => prev.filter((f) => f.id !== id));
  const toggleFeed = (id) =>
    setFeeds((prev) => prev.map((f) => (f.id === id ? { ...f, active: !f.active } : f)));

  const statusLabel = {
    idle: "待機中",
    fetching: "RSS取得中...",
    summarizing: "AI要約中...",
    ready: "準備完了",
    playing: "放送中",
    paused: "一時停止",
  };

  const isLoading = status === "fetching" || status === "summarizing";

  return (
    <div style={s.root}>
      <div style={s.bgGlow} />

      {/* APIキー設定モーダル */}
      {showApiKey && (
        <div style={s.modal}>
          <div style={s.modalBox}>
            <div style={s.modalTitle}>🔑 Claude APIキー設定</div>
            <div style={s.modalDesc}>
              Anthropic Console（console.anthropic.com）で取得したAPIキーを入力してください。
              端末のlocalStorageに保存されます。
            </div>
            <input
              style={s.input}
              type="password"
              placeholder="sk-ant-api03-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
              <button style={s.btnPrimary} onClick={handleSaveApiKey}>保存</button>
              <button style={s.btnSecondary} onClick={() => setShowApiKey(false)}>閉じる</button>
            </div>
          </div>
        </div>
      )}

      {/* ヘッダー */}
      <header style={s.header}>
        <div style={s.logoArea}>
          <span style={{ fontSize: "26px" }}>📻</span>
          <div>
            <div style={s.logoTitle}>AI RADIO</div>
            <div style={s.logoSub}>RSS × Generative Broadcasting</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={s.statusBadge}>
            <span style={{ ...s.statusDot, background: statusColor(status) }} />
            {statusLabel[status]}
          </div>
          <button style={s.btnIcon} onClick={() => setShowApiKey(true)} title="APIキー設定">⚙️</button>
        </div>
      </header>

      {/* タブ */}
      <nav style={s.tabs}>
        {[["radio", "📻 ラジオ"], ["feeds", "📡 フィード"], ["articles", "📰 記事"]].map(([key, label]) => (
          <button
            key={key}
            style={{ ...s.tab, ...(activeTab === key ? s.tabActive : {}) }}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main style={s.main}>
        {/* ===== ラジオ ===== */}
        {activeTab === "radio" && (
          <div style={s.panel}>
            {/* ビジュアライザー */}
            <div style={s.visualizer}>
              {Array.from({ length: 28 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: "7px",
                    borderRadius: "3px 3px 0 0",
                    background: `hsl(${160 + i * 4}, 75%, 52%)`,
                    height: waveActive
                      ? `${25 + Math.abs(Math.sin(i * 0.7)) * 55}%`
                      : "10%",
                    transition: waveActive
                      ? `height ${0.3 + (i % 5) * 0.08}s ease-in-out`
                      : "height 0.5s ease",
                    animation: waveActive ? `waveBar ${0.8 + (i % 7) * 0.15}s ease-in-out infinite alternate` : "none",
                  }}
                />
              ))}
            </div>

            {/* 生成ボタン */}
            <button
              style={{ ...s.btnPrimary, opacity: isLoading ? 0.65 : 1, width: "100%", maxWidth: "360px", alignSelf: "center" }}
              onClick={handleGenerate}
              disabled={isLoading}
            >
              {isLoading ? (
                <><span style={s.spinner} />{statusLabel[status]}</>
              ) : (
                "🎙️ 放送を生成"
              )}
            </button>

            {/* プレイヤー */}
            {(status === "ready" || status === "playing" || status === "paused") && (
              <>
                <div style={s.playerRow}>
                  <button style={s.btnCtrl} onClick={handlePlay} title="最初から再生">⏮</button>
                  <button style={{ ...s.btnCtrlLarge, ...(status === "playing" ? s.btnCtrlActive : {}) }} onClick={handlePauseResume}>
                    {status === "playing" ? "⏸" : "▶"}
                  </button>
                  <button style={s.btnCtrl} onClick={handleStop}>⏹</button>
                </div>

                <div style={s.progressWrap}>
                  <div style={s.progressTrack}>
                    <div style={{ ...s.progressFill, width: `${progress}%` }} />
                  </div>
                  <span style={s.progressPct}>{progress}%</span>
                </div>
              </>
            )}

            {/* スクリプト */}
            {script && (
              <div style={s.scriptBox}>
                <div style={s.scriptLabel}>📝 放送スクリプト</div>
                <div style={s.scriptText}>
                  {(status === "playing" || status === "paused") && displayedText
                    ? displayedText
                    : script}
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

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {feeds.map((feed) => (
                <div key={feed.id} style={s.feedItem}>
                  <button
                    style={{ ...s.toggleBtn, background: feed.active ? "#00e5a0" : "#333" }}
                    onClick={() => toggleFeed(feed.id)}
                  >
                    {feed.active ? "ON" : "OFF"}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={s.feedName}>{feed.name}</div>
                    <div style={s.feedUrl}>{feed.url}</div>
                  </div>
                  <button style={s.btnDelete} onClick={() => handleRemoveFeed(feed.id)}>✕</button>
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
                <div style={{ fontSize: "48px", opacity: 0.3 }}>📰</div>
                <div style={{ color: "#555", fontSize: "14px" }}>「放送を生成」を押すと記事が表示されます</div>
              </div>
            ) : (
              <>
                <div style={s.sectionTitle}>{articles.length}件の記事を取得</div>
                {articles.map((a, i) => (
                  <div key={i} style={s.articleCard}>
                    <div style={s.articleSource}>{a.source}</div>
                    <div style={s.articleTitle}>{a.title}</div>
                    <div style={s.articleDesc}>{a.description}</div>
                    {a.link && (
                      <a href={a.link} target="_blank" rel="noopener noreferrer" style={s.articleLink}>
                        続きを読む →
                      </a>
                    )}
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
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        @keyframes waveBar {
          from { transform: scaleY(0.5); }
          to { transform: scaleY(1); }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
    </div>
  );
}

// ============================================================
// スタイル定義
// ============================================================
const s = {
  root: {
    minHeight: "100vh",
    background: "#0a0a0f",
    color: "#e8e8f0",
    fontFamily: "'Noto Sans JP', sans-serif",
    position: "relative",
    overflowX: "hidden",
  },
  bgGlow: {
    position: "fixed",
    top: "-20%",
    left: "50%",
    transform: "translateX(-50%)",
    width: "500px",
    height: "500px",
    background: "radial-gradient(circle, rgba(0,229,160,0.05) 0%, transparent 70%)",
    pointerEvents: "none",
  },
  modal: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.75)",
    zIndex: 100,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
  },
  modalBox: {
    background: "#111118",
    borderRadius: "16px",
    border: "1px solid rgba(255,255,255,0.1)",
    padding: "24px",
    width: "100%",
    maxWidth: "420px",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    animation: "fadeUp 0.2s ease",
  },
  modalTitle: {
    fontSize: "16px",
    fontWeight: "700",
    color: "#00e5a0",
  },
  modalDesc: {
    fontSize: "12px",
    color: "#777",
    lineHeight: "1.7",
  },
  header: {
    position: "relative",
    zIndex: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "18px 20px 14px",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
  },
  logoArea: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  logoTitle: {
    fontFamily: "'Space Mono', monospace",
    fontSize: "18px",
    fontWeight: "700",
    color: "#00e5a0",
    letterSpacing: "3px",
  },
  logoSub: {
    fontSize: "9px",
    color: "#555",
    letterSpacing: "1px",
    marginTop: "2px",
  },
  statusBadge: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "11px",
    color: "#888",
    fontFamily: "'Space Mono', monospace",
    background: "rgba(255,255,255,0.04)",
    padding: "5px 10px",
    borderRadius: "20px",
    border: "1px solid rgba(255,255,255,0.07)",
  },
  statusDot: {
    width: "7px",
    height: "7px",
    borderRadius: "50%",
    animation: "pulse 2s ease-in-out infinite",
  },
  btnIcon: {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px",
    width: "36px",
    height: "36px",
    cursor: "pointer",
    fontSize: "16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  tabs: {
    position: "relative",
    zIndex: 10,
    display: "flex",
    padding: "0 20px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  },
  tab: {
    background: "none",
    border: "none",
    borderBottom: "2px solid transparent",
    color: "#555",
    fontSize: "13px",
    padding: "12px 18px",
    cursor: "pointer",
    transition: "all 0.2s",
    fontFamily: "'Noto Sans JP', sans-serif",
  },
  tabActive: {
    color: "#00e5a0",
    borderBottom: "2px solid #00e5a0",
  },
  main: {
    position: "relative",
    zIndex: 10,
    padding: "20px",
    maxWidth: "680px",
    margin: "0 auto",
  },
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    animation: "fadeUp 0.25s ease",
  },
  visualizer: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: "4px",
    height: "72px",
    background: "rgba(0,0,0,0.35)",
    borderRadius: "12px",
    padding: "10px 16px",
    border: "1px solid rgba(255,255,255,0.05)",
    overflow: "hidden",
  },
  btnPrimary: {
    background: "linear-gradient(135deg, #00e5a0, #00b4d8)",
    border: "none",
    borderRadius: "10px",
    color: "#0a0a0f",
    fontSize: "15px",
    fontWeight: "700",
    padding: "14px 28px",
    cursor: "pointer",
    fontFamily: "'Noto Sans JP', sans-serif",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    transition: "opacity 0.2s",
  },
  btnSecondary: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "8px",
    color: "#ccc",
    fontSize: "12px",
    padding: "7px 14px",
    cursor: "pointer",
    fontFamily: "'Noto Sans JP', sans-serif",
  },
  playerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "14px",
  },
  btnCtrl: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "50%",
    width: "46px",
    height: "46px",
    color: "#ddd",
    fontSize: "16px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  btnCtrlLarge: {
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "50%",
    width: "60px",
    height: "60px",
    color: "#e8e8f0",
    fontSize: "22px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.2s",
  },
  btnCtrlActive: {
    background: "rgba(0,229,160,0.15)",
    borderColor: "#00e5a0",
    color: "#00e5a0",
  },
  progressWrap: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  progressTrack: {
    flex: 1,
    height: "3px",
    background: "rgba(255,255,255,0.08)",
    borderRadius: "2px",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: "linear-gradient(90deg, #00e5a0, #00b4d8)",
    transition: "width 0.3s ease",
  },
  progressPct: {
    fontFamily: "'Space Mono', monospace",
    fontSize: "10px",
    color: "#555",
    minWidth: "32px",
    textAlign: "right",
  },
  scriptBox: {
    background: "rgba(0,0,0,0.3)",
    borderRadius: "12px",
    padding: "18px",
    border: "1px solid rgba(0,229,160,0.12)",
  },
  scriptLabel: {
    fontSize: "10px",
    color: "#00e5a0",
    letterSpacing: "1px",
    fontFamily: "'Space Mono', monospace",
    marginBottom: "10px",
  },
  scriptText: {
    fontSize: "13px",
    lineHeight: "1.85",
    color: "#bbb",
    whiteSpace: "pre-wrap",
    maxHeight: "280px",
    overflowY: "auto",
  },
  spinner: {
    display: "inline-block",
    width: "13px",
    height: "13px",
    border: "2px solid rgba(0,0,0,0.25)",
    borderTopColor: "#0a0a0f",
    borderRadius: "50%",
    animation: "spin 0.7s linear infinite",
  },
  errorBox: {
    background: "rgba(255,80,80,0.08)",
    border: "1px solid rgba(255,80,80,0.25)",
    borderRadius: "8px",
    padding: "12px 14px",
    fontSize: "13px",
    color: "#ff9090",
    lineHeight: "1.6",
    whiteSpace: "pre-wrap",
  },
  rowBetween: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    fontFamily: "'Space Mono', monospace",
    fontSize: "11px",
    color: "#666",
    letterSpacing: "1px",
  },
  addForm: {
    background: "rgba(0,0,0,0.25)",
    borderRadius: "10px",
    padding: "14px",
    border: "1px solid rgba(255,255,255,0.07)",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  input: {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "6px",
    color: "#e8e8f0",
    fontSize: "13px",
    padding: "10px 13px",
    fontFamily: "'Noto Sans JP', sans-serif",
    width: "100%",
  },
  feedItem: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    background: "rgba(255,255,255,0.025)",
    borderRadius: "10px",
    padding: "12px 14px",
    border: "1px solid rgba(255,255,255,0.05)",
  },
  toggleBtn: {
    border: "none",
    borderRadius: "10px",
    color: "#0a0a0f",
    fontSize: "9px",
    fontWeight: "700",
    padding: "4px 9px",
    cursor: "pointer",
    fontFamily: "'Space Mono', monospace",
    minWidth: "38px",
    transition: "background 0.2s",
  },
  feedName: {
    fontSize: "13px",
    fontWeight: "700",
    marginBottom: "2px",
  },
  feedUrl: {
    fontSize: "10px",
    color: "#444",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  btnDelete: {
    background: "none",
    border: "none",
    color: "#444",
    fontSize: "14px",
    cursor: "pointer",
    padding: "4px",
    flexShrink: 0,
  },
  tip: {
    fontSize: "11px",
    color: "#444",
    lineHeight: "1.6",
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "12px",
    padding: "60px 20px",
  },
  articleCard: {
    background: "rgba(255,255,255,0.025)",
    borderRadius: "10px",
    padding: "14px",
    border: "1px solid rgba(255,255,255,0.05)",
  },
  articleSource: {
    fontSize: "9px",
    color: "#00e5a0",
    fontFamily: "'Space Mono', monospace",
    letterSpacing: "1px",
    marginBottom: "5px",
  },
  articleTitle: {
    fontSize: "13px",
    fontWeight: "700",
    marginBottom: "5px",
    lineHeight: "1.5",
  },
  articleDesc: {
    fontSize: "11px",
    color: "#666",
    lineHeight: "1.65",
    marginBottom: "7px",
  },
  articleLink: {
    fontSize: "11px",
    color: "#00b4d8",
    textDecoration: "none",
  },
};
