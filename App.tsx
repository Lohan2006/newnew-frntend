import React, { useState } from "react";

/* ---------------- TYPES ---------------- */
type ScanResponse = {
  flagged: boolean;
  reasons: string[];
};

/* ---------------- APP ---------------- */
const App: React.FC = () => {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /* ---------------- RULE-BASED CHECK (Frontend) ---------------- */
  const ruleBasedScan = (inputUrl: string): string[] => {
    const reasons: string[] = [];

    if (!inputUrl.startsWith("https://")) {
      reasons.push("URL does not use HTTPS");
    }

    if (inputUrl.includes("@")) {
      reasons.push("URL contains '@' symbol");
    }

    if (inputUrl.length > 75) {
      reasons.push("URL length is unusually long");
    }

    if (/\d+\.\d+\.\d+\.\d+/.test(inputUrl)) {
      reasons.push("IP address used instead of domain name");
    }

    const suspiciousWords = ["login", "verify", "secure", "update", "bank"];
    suspiciousWords.forEach(word => {
      if (inputUrl.toLowerCase().includes(word)) {
        reasons.push(`Suspicious keyword detected: "${word}"`);
      }
    });

    return reasons;
  };

  /* ---------------- SUBMIT HANDLER ---------------- */
  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!url.trim()) {
      setError("Please enter a URL.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    /* 1️⃣ Run rule-based scan first */
    const ruleReasons = ruleBasedScan(url);

    try {
      /* 2️⃣ Send URL to backend APIs */
      const response = await fetch("http://localhost:5000/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        throw new Error("Backend error");
      }

      const apiResult: ScanResponse = await response.json();

      /* 3️⃣ Combine results */
      setResult({
        flagged: ruleReasons.length > 0 || apiResult.flagged,
        reasons: [...ruleReasons, ...apiResult.reasons],
      });

    } catch (err) {
      setError("Could not connect to backend. Is it running?");
    } finally {
      setLoading(false);
    }
  };

  /* ---------------- UI ---------------- */
  return (
    <div style={{ maxWidth: "600px", margin: "40px auto", fontFamily: "Arial" }}>
      <h1>🔐 Phishing Detection Tool</h1>
      <p>Enter a URL to analyze using rule-based + API detection</p>

      <form onSubmit={handleScan} style={{ marginBottom: "20px" }}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          style={{ width: "70%", padding: "10px" }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{ marginLeft: "10px", padding: "10px 20px" }}
        >
          {loading ? "Scanning..." : "Scan"}
        </button>
      </form>

      {error && <p style={{ color: "orange" }}>{error}</p>}

      {result && (
        <div
          style={{
            padding: "20px",
            borderRadius: "8px",
            border: `2px solid ${result.flagged ? "red" : "green"}`,
            background: result.flagged ? "#fff5f5" : "#f0fff4",
          }}
        >
          <h2>{result.flagged ? "🚨 FLAGGED" : "✅ SAFE"}</h2>
          <ul>
            {result.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default App;
