// App.tsx
import React, { useState, useEffect } from 'react';
import './App.css';
import { ref, set, get, push, onValue } from "firebase/database";
import { db } from "./firebase";
import { Routes, Route, useNavigate } from "react-router-dom";
import Community from './Community';



/*
  Safe Link — Rule-Based Scoring (0..10 safety)
  - Starts at 0, applies integer points to reach a max of 10.
*/

type Tier = 'High Risk' | 'Be Careful' | 'Safe';


interface Comment {
  id: string;
  text: string;
  timestamp: string;
  userId: string;
  imagesBase64?: string[]; // optional uploaded images
}

interface ScanResult {
  
  id: string;
  url: string;
  safety: number;
  tier: Tier;
  color: string;
  confidence: number;
  reasons: string[];
  breakdown: Record<string, number>;
  timestamp: string;
  likes?: number;
  dislikes?: number;
  userReaction?: 'like' | 'dislike' | null; // LOCAL ONLY, never persisted
  comments?: Comment[];
  showCommentInput?: boolean;
  newComment?: string;
  newCommentImages?: string[];
  apiCheck?: {
    done: boolean;
    note: string;
    checks?: Record<string, any>;
    failed?: boolean;
  } | null; // ✅ allow null initially
  showCommentError?: boolean; // ✅ add this
}

const sortScans = (a: ScanResult, b: ScanResult) => {
  // 1️⃣ Tier priority: Unsafe → Suspicious → Safe
  const tierOrder: Record<string, number> = {
    'High Risk': 0,
    'Be Careful': 1,
    'Safe': 2,
  };

  if (tierOrder[a.tier] !== tierOrder[b.tier]) {
    return tierOrder[a.tier] - tierOrder[b.tier];
  }

  // 2️⃣ Within same tier: MOST DISLIKED FIRST
  const aDislikes = a.dislikes ?? 0;
  const bDislikes = b.dislikes ?? 0;

  if (aDislikes !== bDislikes) {
    return bDislikes - aDislikes;
  }

  // 3️⃣ Fallback: newest first
  const dateA = new Date(a.timestamp).getTime();
  const dateB = new Date(b.timestamp).getTime();
  return dateB - dateA;
};





async function addCommentWithImages(scanId: string, text: string, images: string[] = []) {
  const key = safeKey(scanId);
  const newComment: Comment = {
    id: crypto.randomUUID(),
    text,
    timestamp: new Date().toLocaleString(),
    userId: getUserId(),
    imagesBase64: images,
  };

  // Push to Firebase (instead of overwriting)
  const newCommentRef = push(ref(db, `links/${key}/comments`));
  await set(newCommentRef, newComment);

  // Return updated comments
  const snapshot = await get(ref(db, `links/${key}/comments`));
  return snapshot.exists() ? Object.values(snapshot.val()) as Comment[] : [];
}







const getUserId = () => {
  let id = localStorage.getItem("safeLinkUserId");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("safeLinkUserId", id);
  }
  return id;
};






/* ---------- Helpers ---------- */
const clamp = (v: number, a = 0, b = 1e9) => Math.max(a, Math.min(b, v));

function isProbablyShortener(host: string) {
  return /(bit\.ly|tinyurl|goo\.gl|t\.co|ow\.ly|buff\.ly|rb\.gy|short\.ly|is\.gd)/i.test(host);
}

function hasUrgentKeywords(text: string) {
  return /(verify|reset|update|confirm|secure|account|login|unauthorized|suspend|password|malware|scam|phish|download|virus)/i.test(text);
}

async function mockDomainAgeDays(host: string) {
  if (/google\.com|apple\.com|microsoft\.com|amazon\.com/i.test(host)) return 365 * 10;
  if (host.includes('new-') || host.includes('recent') || host.includes('young')) return 12;
  if (host.includes('old-') || host.includes('established')) return 365 * 3;
  return Math.min(365 * 3, Math.max(10, host.length * 20));
}

async function mockHasValidSsl(url: string) {
  if (/selfsigned|invalid-cert|testcert/.test(url)) return false;
  return !url.startsWith('http://');
}

async function mockIsBlacklisted(host: string) {
  return /badsite|phish|malicious|malware-download/i.test(host);
}

async function mockHasExcessiveRedirects(url: string) {
  return /(redirect|redir|continue|next=|returnurl)/i.test(url) || isProbablyShortener(parseHost(url).host);
}

function isShortAndClean(host: string) {
  const parts = host.split('.');
  if (/google\.com|apple\.com|microsoft\.com|amazon\.com/i.test(host)) return true;
  return parts.length <= 3 && host.length < 25 && !host.includes('-');
}

function parseHost(raw: string) {
  try {
    const normalized = raw.startsWith('http') ? raw : 'https://' + raw;
    const u = new URL(normalized);
    return { host: u.hostname, path: u.pathname + u.search };
  } catch {
    const host = raw.split('/')[0];
    const path = raw.includes('/') ? raw.slice(raw.indexOf('/')) : '';
    return { host, path };
  }
}

function didAllApisFail(checks?: Record<string, any>) {
  if (!checks) return false;
  return Object.values(checks).every(
    (c: any) => c.checked === false || c.status === "error"
  );
}


/* ---------- Scoring ---------- */
async function scoreUrl(raw: string) {
  const { host } = parseHost(raw);
  const lowerHost = host.toLowerCase();
  const lowerUrl = (raw || '').toLowerCase();
  const isKnownSafeDomain = /google\.com|apple\.com|microsoft\.com|amazon\.com/i.test(lowerHost);

  let score = 0;
  const breakdown: Record<string, number> = {};

  const isHttps = raw.startsWith('https://');
  if (isHttps || (isKnownSafeDomain && !raw.startsWith('http://'))) {
    breakdown.https = 2;
    score += 2;
  } else breakdown.https = 0;

  const hasValidSsl = await mockHasValidSsl(raw);
  if (hasValidSsl) {
    breakdown.ssl = 2;
    score += 2;
  } else breakdown.ssl = 0;

  const isBlacklisted = await mockIsBlacklisted(host);
  if (!isBlacklisted) {
    breakdown.blacklisted = 2;
    score += 2;
  } else {
    breakdown.blacklisted = -2;
    score -= 2;
  }

  const isClean = isShortAndClean(host);
  if (isClean) {
    breakdown.cleanDomain = 1;
    score += 1;
  } else breakdown.cleanDomain = 0;

  const hasSuspicious = hasUrgentKeywords(lowerHost) || hasUrgentKeywords(lowerUrl);
  if (!hasSuspicious) {
    breakdown.suspiciousKeywords = 1;
    score += 1;
  } else {
    breakdown.suspiciousKeywords = -1;
    score -= 1;
  }

  const ageDays = await mockDomainAgeDays(host);
  const isEstablished = ageDays > 180;
  if (isEstablished) {
    breakdown.domainAge = 1;
    score += 1;
  } else breakdown.domainAge = 0;

  const hasRedirects = await mockHasExcessiveRedirects(raw);
  if (!hasRedirects) {
    breakdown.redirects = 1;
    score += 1;
  } else {
    breakdown.redirects = -1;
    score -= 1;
  }

  score = clamp(Math.round(score), 0, 10);
  const safety = score;
  const tier: Tier = safety <= 3 ? 'High Risk' : safety <= 6 ? 'Be Careful' : 'Safe';
  const color = safety <= 3 ? '#ef4444' : safety <= 6 ? '#f59e0b' : '#10b981';
  const positiveScore = Object.values(breakdown).filter(v => v > 0).reduce((a, b) => a + b, 0);
  const confidence = clamp(positiveScore / 10);

  const reasons: string[] = [];
  if (safety <= 6) {
    if (breakdown.blacklisted === -2) reasons.push('Domain is flagged on threat lists.');
    if (breakdown.suspiciousKeywords === -1) reasons.push('URL contains suspicious, urgent keywords.');
    if (breakdown.redirects === -1) reasons.push('Excessive redirects or shortener detected.');
    if (breakdown.https === 0) reasons.push('Missing HTTPS for a secure connection.');
    if (breakdown.ssl === 0) reasons.push('Missing or invalid SSL Certificate.');
    if (breakdown.domainAge === 0) reasons.push('Domain is less than 6 months old.');
  }

  if (reasons.length === 0 || safety > 6) {
    if (breakdown.https === 2) reasons.push('✔ Uses HTTPS for a secure connection.');
    if (breakdown.ssl === 2) reasons.push('✔ Valid SSL Certificate detected.');
    if (breakdown.blacklisted === 2) reasons.push('✔ Domain is not flagged on threat lists.');
    if (breakdown.cleanDomain === 1) reasons.push('✔ Domain name is short and clean.');
    if (breakdown.suspiciousKeywords === 1) reasons.push('✔ No suspicious keywords found.');
    if (breakdown.domainAge === 1) reasons.push('✔ Domain is established (over 6 months old).');
    if (breakdown.redirects === 1) reasons.push('✔ No excessive redirects detected.');
  }

  if (reasons.length === 0) reasons.push('Analysis complete. No specific flags found, but score is 0. Check for valid domain format.');


  // ✅ FINAL ScanResult
  const result: ScanResult = {
    id: crypto.randomUUID(), // unique id
    url: raw.startsWith("http") ? raw : "https://" + raw,
    safety,
    tier,
    color,
    confidence,
    reasons,
    breakdown,
    timestamp: new Date().toLocaleString(),
    likes: 0,
    dislikes: 0,
    userReaction: null,
    apiCheck: null,
  };

  return result;
}







/* ----------  external check ---------- */
async function realExternalLookup(url: string) {
  try {
    const res = await fetch("http://localhost:5000/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      console.error("External API error:", res.status);
      return null;
    }
    const data = await res.json();
    return data;
  } catch (e) {
    console.error("Fetch failed:", e);
    return null;
  }
}



/* ---------- Domain validation ---------- */
async function isDomainValid(host: string): Promise<boolean> {
  // Whitelist of well-known domains that we assume are valid
  const wellKnownDomains = [
    'google.com', 'youtube.com', 'facebook.com', 'amazon.com',
    'ebay.com', 'wikipedia.org', 'twitter.com', 'instagram.com',
    'linkedin.com', 'microsoft.com', 'apple.com', 'netflix.com',
    'github.com', 'stackoverflow.com', 'khanacademy.org', 'coursera.org'
  ];
  
  const cleanHost = host.replace(/^www\./, '');
  
  // Check if it's a well-known domain
  if (wellKnownDomains.some(domain => 
      cleanHost === domain || cleanHost.endsWith(`.${domain}`))) {
    return true;
  }
  
  // For other domains, do the fetch check with multiple attempts
  const urlsToTry = [
    `https://${host}/favicon.ico`,
    `https://www.${host}/favicon.ico`,
    `http://${host}/favicon.ico`,
    `http://www.${host}/favicon.ico`
  ];
  
  // Remove duplicates
  const uniqueUrls = [...new Set(urlsToTry)];
  
  for (const url of uniqueUrls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      
      await fetch(url, {
        method: 'GET',
        mode: 'no-cors',
        signal: controller.signal,
        cache: 'no-cache',
        headers: {
          'Accept': 'image/*,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (compatible; SafeLinkScanner/1.0)'
        }
      });
      
      clearTimeout(timeoutId);
      return true;
    } catch (error) {
      continue; // Try next URL variant
    }
  }
  
  return false;
}






const safeKey = (url: string) => {
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    return u.hostname.replace(/[.#$/\[\]]/g, "_") + u.pathname.replace(/[.#$/\[\]]/g, "_");
  } catch {
    return url.replace(/[.#$/\[\]]/g, "_");
  }
};




// Save scan result to Firebase (history)


export const saveScanToFirebase = async (scanResult: ScanResult) => {
  try {
    // Generate a unique ID in 'history'
    const newRef = push(ref(db, 'history'));
    const scanWithId = { ...scanResult, id: newRef.key }; // ensure scan has id
    await set(newRef, scanWithId);

    // Create a separate 'links' entry for reactions/comments
    const key = safeKey(scanResult.url);
    await set(ref(db, `links/${key}`), {
      likes: scanResult.likes ?? 0,
      dislikes: scanResult.dislikes ?? 0,
      userReaction: scanResult.userReaction ?? null,
      comments: scanResult.comments ?? []
    });

    console.log("Scan saved:", scanWithId);

  } catch (err) {
    console.error("Firebase write error:", err);
  }
};



/* ---------- React component ---------- */
export default function App() {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<ScanResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  



const runExternalCheck = async () => {
  if (!scan) return;
  setLoading(true);
  setError(null);

  try {
    console.log("Running external check for:", scan.url);
    const ext = await realExternalLookup(scan.url);
    console.log("External API response:", ext);

    if (!ext) {
      setError("External API scan failed");
      return;
    }

    const allFailed = didAllApisFail(ext.checks);

    // 🔥 Start from current safety
    let finalSafety = scan.safety;

    // Adjust safety based on API verdict
    if (ext.finalVerdict === "malicious") {
      finalSafety = Math.min(finalSafety, 1);
    } else if (ext.finalVerdict === "suspicious") {
      finalSafety = Math.min(finalSafety, 4);
    }

    const finalTier: Tier =
      finalSafety <= 3 ? "High Risk" :
      finalSafety <= 6 ? "Be Careful" :
      "Safe";

    const finalColor =
      finalSafety <= 3 ? "#ef4444" :
      finalSafety <= 6 ? "#f59e0b" :
      "#10b981";

    const updatedScan: ScanResult = {
      ...scan,
      safety: finalSafety,
      tier: finalTier,
      color: finalColor,
      apiCheck: {
        done: true,
        failed: allFailed,
        note: allFailed ? "External API scan failed" : ext.summary,
        checks: ext.checks || {},
      },
    };

    // ✅ 1. Update main scan
    setScan(updatedScan);

    // ✅ 2. Update recent scans (THIS FIXES THE BUG)
    setHistory(prev =>
      prev
        .map(s => (s.id === scan.id ? updatedScan : s))
        .sort(sortScans)
        .slice(0, 5)
    );

  } catch (e) {
    console.error("External API scan failed:", e);
    setError("External API scan failed. Check console for details.");
  } finally {
    setLoading(false);
  }
};



  /* ---------- Load history from Firebase ---------- */
useEffect(() => {
  const historyRef = ref(db, 'history');

  const loadHistory = async () => {
    try {
      const snapshot = await get(historyRef);
      if (!snapshot.exists()) return setHistory([]);

      const data = Object.values(snapshot.val()) as ScanResult[];

      // Fetch reactions and comments for each scan
      const reactionsSnapshot = await get(ref(db, 'links'));
      const reactions = reactionsSnapshot.val() || {};

      const merged = await Promise.all(
        data.map(async scan => {
          const key = safeKey(scan.url);
          const reaction = reactions[key] || {};

          const commentsSnap = await get(ref(db, `links/${key}/comments`));
          const comments = commentsSnap.exists()
            ? (Object.values(commentsSnap.val()) as Comment[])
            : [];

          return {
            ...scan,
            likes: reaction.likes ?? 0,
            dislikes: reaction.dislikes ?? 0,
            userReaction: reaction.userReaction ?? null,
            comments,
            showCommentInput: false
          };
        })
      );

      merged.sort(sortScans);
      setHistory(merged.slice(0, 5));

    } catch (err) {
      console.error("Firebase load error:", err);
    }
  };

  loadHistory();

  // Realtime updates
onValue(historyRef, async snapshot => {
  if (!snapshot.exists()) return setHistory([]);

  const data = Object.values(snapshot.val()) as ScanResult[];

  const reactionsSnapshot = await get(ref(db, 'links'));
  const reactions = reactionsSnapshot.val() || {};

  const merged = data.map(scan => {
    const key = safeKey(scan.url);
    const reaction = reactions[key] || {};

    // Safe cast to Partial<ScanResult> to satisfy TS
    const localScan: Partial<ScanResult> = history.find(s => s.url === scan.url) || {};

    return {
      ...scan,
      likes: reaction.likes ?? scan.likes ?? 0,
      dislikes: reaction.dislikes ?? scan.dislikes ?? 0,
      userReaction: reaction.userReaction ?? localScan.userReaction ?? null,
      comments: localScan.comments ?? scan.comments ?? [],
      newComment: localScan.newComment ?? scan.newComment ?? '',
    };
  });

  merged.sort(sortScans);
  setHistory(merged.slice(0, 5));
});



}, []);





  const validateInput = (v: string) => {
    if (!v || !v.trim()) return false;
    return /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/.*)?$/.test(v) || /^https?:\/\//.test(v);
  };

const handleAnalyze = async (e?: React.FormEvent) => {
  e?.preventDefault();
  setError(null);

  if (!validateInput(input)) {
    setError('Please enter a valid address like example.com or https://example.com');
    return;
  }

  setLoading(true);
  setScan(null);

  try {
    const { host } = parseHost(input);
    const exists = await isDomainValid(host);  
    if (!exists) {
      setError('The domain does not exist or cannot be reached.');
      setLoading(false);
      return;
    }

    const scanResult = await scoreUrl(input);  
    setScan(scanResult);

    // Add to recent history (keep max 12)
    setHistory(h => {
      const updatedHistory = [scanResult, ...h].slice(0, 5);
      return updatedHistory;
    });

    // ✅ Save scan result to Firebase
    await saveScanToFirebase(scanResult);

    // Automatically trigger API scan if yellow (safety 4–6)
    if (scanResult.safety > 3 && scanResult.safety <= 6) {
      await runExternalCheck(); // your existing function
    }

  } catch (err) {
    console.error(err);
    setError('Analysis failed. Try again.');
  } finally {
    setLoading(false);
  }
};


const clearHistory = async () => {
  setHistory([]); // clear local state
  try {
    // Clear history
    await set(ref(db, 'history'), {});
    // Clear likes/dislikes and user reactions
    await set(ref(db, 'links'), {});
  } catch (err) {
    console.error("Firebase clear error:", err);
  }
};








  
  /* ---------- UI (unchanged) ---------- */
  return (
      <Routes>
    <Route
      path="/"
      element={
    <div className="glass-app">
      <div className="bg-visual" style={{ backgroundImage: "url('/mnt/data/5ce9f39a-3ebd-4cd8-a632-de55debc40cc.png')" }} />

      <main className="glass-card" aria-live="polite">
        <header className="top">
          <div className="brand">
            <div className="brand-icon">🛡️</div>
            <div>
              <h1>Safe Link</h1>
              <p className="subtitle">Fast, explainable link checks — stop scammers before they trick people</p>
            </div>
          </div>
          <div className="version">Rule-based engine and Real-Time API Intergration</div>
        </header>

        <section className="scanner">
          <form onSubmit={handleAnalyze} className="scanner-form" aria-label="URL scanner">
            <div className="input-wrap">
              <svg className="input-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M10 3a7 7 0 0 0 0 14 7 7 0 1 0 0-14zM21 21l-4.35-4.35" /></svg>
              <input aria-label="URL or hostname" placeholder="example.com or https://example.com" value={input} onChange={(e) => setInput(e.target.value)} disabled={loading} />
              <button type="submit" className="scan-btn" disabled={loading} aria-disabled={loading}>{loading ? 'Analyzing…' : 'Analyze'}</button>
            </div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="quick">
              <button type="button" onClick={() => setInput('https://www.google.com/')}>google.com</button>
              <button type="button" onClick={() => setInput('https://www.khanacademy.org/')}>khanacademy.org</button>
              <button type="button" onClick={() => setInput('https://www.coursera.org/')}>coursera.org</button>
              <button type="button" onClick={() => setInput('https://www.ebay.com/')}>ebay.com</button>
            </div>
          </form>
        </section>

        <section className="results-area">
          {scan ? (
            <article className="result-card" aria-label="scan result">
              <div className="score-column">
                <div className="circle-wrap" style={{ ['--accent' as any]: scan.color }}>
                  <svg viewBox="0 0 120 120" className="score-ring" aria-hidden>
                    <circle cx="60" cy="60" r="48" className="ring-bg" />
                    <circle cx="60" cy="60" r="48" className="ring-progress" style={{ strokeDashoffset: `${2 * Math.PI * 48 * (1 - (scan.safety / 10))}px` }} />
                  </svg>
                  <div className="score-number">{scan.safety}</div>
                  <div className={`score-label ${scan.safety <= 3 ? 'high' : scan.safety <= 6 ? 'medium' : 'low'}`}>{scan.tier}</div>
                </div>
                <div style={{marginTop:8, textAlign:'center', color:'var(--muted)', fontSize:12}}>Confidence: {(scan.confidence * 100).toFixed(0)}%</div>
              </div>

              <div className="meta-column">
                <div className="meta-top">
                  <div className="report-title">Security Report</div>
                  <div className="reported-url">{scan.url}</div>
                </div>

                <div className="reasons">
                  <strong>Analysis based on rules</strong>
                  <ul>{scan.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>

                <div className="actions">
                  <button className="visit-btn" onClick={() => window.open(scan.url, '_blank')} disabled={scan.safety < 4} aria-disabled={scan.safety < 4} title={scan.safety < 4 ? 'Blocked by policy' : 'Open the site'}>
                    {scan.safety < 4 ? 'Blocked (unsafe)' : 'Visit site'}
                  </button>
                  
                 <div className="api-group">
                    {scan.safety <= 3 ? (
                      <div className="api-note">High risk — do not visit. Consider reporting this link.</div>
                    ) : (
                      <button
  className="api-btn"
  onClick={runExternalCheck}
  disabled={loading || !!scan.apiCheck?.done}
>
  {scan.apiCheck?.done ? 'External check done' : 'Run API check'}
</button>
                    )}
                    <button className="new-btn" onClick={() => { setScan(null); setInput(''); }}>New check</button>
                  </div>


                  {loading && (
                    <div className="loader-below-buttons">
                      <div className="bouncing-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                      <p className="loading-text">Running external security checks…</p>
                    </div>
                  )}
                </div>


                {scan.apiCheck && (
  <>
                {/* External API results */}
                <div className="api-result">
                  <strong>External:</strong> {scan.apiCheck.note}

                  {scan.apiCheck.checks && (
                    <div className="api-detailed">
                      <strong>Detailed API Results:</strong>
                      <ul>
                        {Object.entries(scan.apiCheck.checks).map(([key, val]: any) => (
                          <li key={key}>
                            {key}: {val.status} — {val.details}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className={`final-decision ${scan.tier.replace(' ', '-').toLowerCase()}`}>
                {scan.tier === "Safe" && (
                  <>
                    ✅ <strong>Safe to Proceed</strong>

                    {scan.apiCheck?.failed ? (
                      <p className="decision-text">
                        External security services could not be reached at this time.
                        Based on local rule-based analysis, no immediate threats were detected.
                        Proceed with normal caution.
                      </p>
                    ) : (
                      <p className="decision-text">
                        This link was checked using trusted security services and no threats were found.
                        You can open it safely.
                      </p>
                    )}
                  </>
                )}

                  {scan.tier === "Be Careful" && (
                    <>
                      ⚠️ <strong>Proceed with Caution</strong>
                      <p className="decision-text">
                        This link does not look dangerous, but some warning signs were detected.
                        Avoid entering personal information.
                      </p>
                    </>
                  )}

                  {scan.tier === "High Risk" && (
                    <>
                      ❌ <strong>Unsafe – Do Not Proceed</strong>
                      <p className="decision-text">
                        This link is reported as harmful by security services.
                        Opening it may put your device or data at risk.
                      </p>
                    </>
                  )}
                </div>
              </>
            )}
            
              </div>
            </article>
          ) : (
            <div className="placeholder">Enter a link and press Analyze — we'll show a safety score (0–10) and clear reasons you can act on.</div>
          )}
          
        </section>


<section className="history-section">
  
  <div className="history-head">
    <div>Recent checks</div>
    <div><button className="clear-btn" onClick={clearHistory}>Clear</button></div>
  </div>
  <div className="history-list">
  {history.length === 0 ? (
    <div className="empty-history">No checks yet</div>





  ) : (
    history.map((h) => (
      <div key={h.id} className="history-item">
        <div className="h-url">{h.url.replace(/^https?:\/\//, '')}</div>




        {/* Score + Reactions horizontally */}
        <div className="result-reactions">
          {/* Score */}
          <div className="result-score-inline" style={{ backgroundColor: h.color }}>
            {h.safety}
          </div>




          {/* Like button */}
          <button
            className={`reaction-btn ${h.userReaction === 'like' ? 'liked' : ''}`}
            onClick={async () => {
              const key = safeKey(h.url);
              let newReaction: 'like' | 'dislike' | null = h.userReaction ?? null;
              let likes = h.likes || 0;
              let dislikes = h.dislikes || 0;

              if (newReaction === 'like') {
                newReaction = null;
                likes--;
              } else {
                if (newReaction === 'dislike') dislikes--;
                newReaction = 'like';
                likes++;
              }

              await set(ref(db, `links/${key}`), { likes, dislikes, userReaction: newReaction });

              setHistory(prev =>
                prev.map(s =>
                  s.id === h.id
                    ? { ...s, likes, dislikes, userReaction: newReaction }
                    : s
                ).sort(sortScans)
              );
            }}
          >
           <svg viewBox="0 0 24 24">
  <path d="M2 21h4V9H2v12zm20-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L13.17 2 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h7c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-1z"/>
</svg>
            {h.likes || 0}
          </button>









          

          {/* Dislike button */}
          <button
            className={`reaction-btn ${h.userReaction === 'dislike' ? 'disliked' : ''}`}
            onClick={async () => {
              const key = safeKey(h.url);
              let newReaction: 'like' | 'dislike' | null = h.userReaction ?? null;
              let likes = h.likes || 0;
              let dislikes = h.dislikes || 0;

              if (newReaction === 'dislike') {
                newReaction = null;
                dislikes--;
              } else {
                if (newReaction === 'like') likes--;
                newReaction = 'dislike';
                dislikes++;
              }

              await set(ref(db, `links/${key}`), { likes, dislikes, userReaction: newReaction });

              setHistory(prev =>
                prev.map(s =>
                  s.id === h.id
                    ? { ...s, likes, dislikes, userReaction: newReaction }
                    : s
                ).sort(sortScans)
              );
            }}
          >
            <svg viewBox="0 0 24 24">
  <path d="M2 3h4v12H2V3zm20 11c0 1.1-.9 2-2 2h-6.31l.95 4.57.03.32c0 .41-.17.79-.44 1.06L13.17 22l-5.58-5.59C7.22 16.05 7 15.55 7 15V5c0-1.1.9-2 2-2h7c.83 0 1.54.5 1.84 1.22l3.02 7.05c.09.23.14.47.14.73v1z"/>
</svg>
            {h.dislikes || 0}
          </button>






          {/* Comment button */}
         <button
  className="reaction-btn comment-btn"
  onClick={async () => {
    const key = safeKey(h.url);

    // If opening comments for the first time, load from Firebase
    if (!h.showCommentInput) {
      const snapshot = await get(ref(db, `links/${key}/comments`));
      const comments = snapshot.exists()
        ? (Object.values(snapshot.val()) as Comment[])
        : [];

      setHistory(prev =>
        prev.map(s =>
          s.id === h.id
            ? { ...s, comments, showCommentInput: true }
            : s
        )
      );
    } else {
      // Just toggle off
      setHistory(prev =>
        prev.map(s =>
          s.id === h.id
            ? { ...s, showCommentInput: false }
            : s
        )
      );
    }
  }}
>
  <svg viewBox="0 0 24 24">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
  </svg>
  {h.comments?.length || 0}
</button>

</div>










{h.showCommentInput && (
  <div className="comment-box">
    {/* Existing comments */}
    {h.comments && h.comments.length > 0 && (
      <div className="comments-list">
        {h.comments.map(c => (
          <div key={c.id} className="comment-item">
            <span className="comment-text">{c.text}</span>
            <span className="comment-time">{c.timestamp}</span>
            {c.imagesBase64 && c.imagesBase64.length > 0 && (
              <div className="comment-images">
                {c.imagesBase64.map((img, idx) => (
                  <img key={idx} src={img} alt="uploaded" />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    )}





  {/* Add new comment */}
    <div className="comment-input-row">
      <input
        type="text"
        placeholder="Add a comment…"
        value={h.newComment || ''}
        onChange={e => {
          const val = e.target.value;
          setHistory(prev =>
            prev.map(s =>
              s.id === h.id ? { ...s, newComment: val } : s
            )
          );
        }}

        
      />










       {/* Image upload */}
       <label className="image-upload-btn">
        Add Photo
    <input
  type="file"
  accept="image/png, image/jpeg"
  multiple
  onChange={async (e) => {
    const files = e.target.files;
    if (!files) return;

    for (let i = 0; i < files.length && i < 3; i++) {
      const file = files[i];

      // ✅ Type check (PNG / JPG / JPEG)
      if (!['image/png', 'image/jpeg'].includes(file.type)) {
        alert('Only JPG and PNG images are allowed');
        continue;
      }

      // ✅ Size check (< 6MB)
      if (file.size > 6 * 1024 * 1024) {
        alert('Image size must be less than 6MB');
        continue;
      }

      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target?.result as string;

        setHistory(prev =>
          prev.map(s =>
            s.id === h.id
              ? {
                  ...s,
                  newCommentImages: [
                    ...(s.newCommentImages || []),
                    base64
                  ].slice(0, 3) // max 3 images
                }
              : s
          )
        );
      };

      reader.readAsDataURL(file);
    }

    // 🔄 reset input so same file can be selected again
    e.target.value = '';
  }}
  
/>

</label>




{h.newCommentImages && h.newCommentImages.length > 0 && (
      <div className="new-comment-preview">
        {h.newCommentImages.map((img, idx) => (
          <img key={idx} src={img} alt="preview" />
        ))}
      </div>
    )}

{/* Error message */}
  {h.showCommentError && (
    <div className="comment-error" role="alert">
      Please add a comment or attach an image
    </div>
  )}

<button
  onClick={async () => {
    if (!h.newComment?.trim() && (!h.newCommentImages || h.newCommentImages.length === 0)) {
      setHistory(prev =>
        prev.map(s =>
          s.id === h.id ? { ...s, showCommentError: true } : s
        )
      );
      return;
    }

    const updatedComments = await addCommentWithImages(
      h.url,
      h.newComment?.trim() || '',
      h.newCommentImages || []
    );

    setHistory(prev =>
      prev.map(s =>
        s.id === h.id
          ? { ...s, comments: updatedComments, newComment: '', newCommentImages: [], showCommentError: false }
          : s
      )
    );
  }}
>
  Comment
</button>


    </div>
  </div>
)}








      </div>
      )

      ))}
</div>

</section>


    <button className="community-btn" onClick={() => navigate("/community")}>
      Community Features
    </button>




        

        <footer className="app-foot">Safe Link © 2025 — Fast, clear, and reliable link safety scoring </footer>
      </main>
    </div>
          }
    />

  <Route path="/community" element={<Community />} />
</Routes>
  );
}
