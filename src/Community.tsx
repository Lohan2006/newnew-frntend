import { useEffect, useState } from 'react';
import './Community.css';
import './App.css';
import { db } from './firebase';
import { ref, get, onValue, set } from "firebase/database";
import { useNavigate } from 'react-router-dom';

interface Comment {
  id: string;
  text: string;
  timestamp: string;
}

interface ScanResult {
  id: string;
  url: string;
  safety: number;
  tier: string;
  color: string;
  timestamp: string;

  likes?: number;
  dislikes?: number;
  userReaction?: 'like' | 'dislike' | null;

  comments?: Comment[];
  newComment?: string;
  showCommentInput?: boolean;
}

// Helper to sort by newest first
// Sort scans: High Risk (red) first, then Be Careful (yellow), then Safe (green)
// Within each tier, sort by likes descending, then newest first
const sortScans = (a: ScanResult, b: ScanResult) => {
  // Define tier priority (higher number = more risky)
  const tierPriority: Record<string, number> = {
    'High Risk': 3,   // red
    'Be Careful': 2,  // yellow
    'Safe': 1         // green
  };

  const tierDiff = (tierPriority[b.tier] || 0) - (tierPriority[a.tier] || 0);
  if (tierDiff !== 0) return tierDiff;

  // Same tier → higher dislikes first
  const dislikesDiff = (b.dislikes ?? 0) - (a.dislikes ?? 0);
  if (dislikesDiff !== 0) return dislikesDiff;

  // Same dislikes → higher likes first
  const likesDiff = (b.likes ?? 0) - (a.likes ?? 0);
  if (likesDiff !== 0) return likesDiff;

  // Same likes → newest first
  return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
};



// Firebase key safe
const safeKey = (url: string) => url.replace(/[.#$/\[\]]/g, '_');

// Add a comment in Firebase
const addComment = async (url: string, text: string) => {
  const key = safeKey(url);
  const comment: Comment = {
    id: Date.now().toString(),
    text,
    timestamp: new Date().toLocaleString()
  };

  const snapshot = await get(ref(db, `history/${key}/comments`));
  const existing = snapshot.exists() ? Object.values(snapshot.val()) as Comment[] : [];
  const updated = [...existing, comment];

  await set(ref(db, `history/${key}/comments`), updated);
  return updated;
};

export default function Community() {
  const [history, setHistory] = useState<ScanResult[]>([]);
  const [search, setSearch] = useState('');

  const navigate = useNavigate();


  // Load history from Firebase
useEffect(() => {
  const historyRef = ref(db, 'history');

  const loadScans = async () => {
    const snapshot = await get(historyRef);
    if (!snapshot.exists()) {
      setHistory([]);
      return;
    }
    const data = Object.values(snapshot.val()) as ScanResult[];
    data.sort(sortScans); // <- new enhanced sort
    setHistory(data.slice(0, 20));
  }; // <-- MISSING SEMICOLON / closing brace

  loadScans();

  // Real-time updates
  onValue(historyRef, snapshot => {
    if (!snapshot.exists()) {
      setHistory([]);
      return;
    }
    const data = Object.values(snapshot.val()) as ScanResult[];
    data.sort(sortScans);
    setHistory(data.slice(0, 20));
  });
}, []);


  // Filter based on search
  const filteredHistory = history.filter(h =>
    h.url.toLowerCase().includes(search.toLowerCase())
  );

  // Like a scan
  const handleLike = async (scan: ScanResult) => {
    const newReaction = scan.userReaction === 'like' ? null : 'like';
    const updatedLikes = newReaction === 'like' ? (scan.likes ?? 0) + 1 : (scan.likes ?? 1) - 1;
    const updatedDislikes = newReaction === 'like' && scan.userReaction === 'dislike'
      ? (scan.dislikes ?? 1) - 1 : scan.dislikes ?? 0;

    // Update Firebase
    await set(ref(db, `history/${scan.id}/likes`), updatedLikes);
    await set(ref(db, `history/${scan.id}/dislikes`), updatedDislikes);
    await set(ref(db, `history/${scan.id}/userReaction`), newReaction);

    // Update state
    setHistory(prev =>
      prev.map(h =>
        h.id === scan.id
          ? { ...h, likes: updatedLikes, dislikes: updatedDislikes, userReaction: newReaction }
          : h
      )
    );
  };

  // Dislike a scan
  const handleDislike = async (scan: ScanResult) => {
    const newReaction = scan.userReaction === 'dislike' ? null : 'dislike';
    const updatedDislikes = newReaction === 'dislike' ? (scan.dislikes ?? 0) + 1 : (scan.dislikes ?? 1) - 1;
    const updatedLikes = newReaction === 'dislike' && scan.userReaction === 'like'
      ? (scan.likes ?? 1) - 1 : scan.likes ?? 0;

    // Update Firebase
    await set(ref(db, `history/${scan.id}/dislikes`), updatedDislikes);
    await set(ref(db, `history/${scan.id}/likes`), updatedLikes);
    await set(ref(db, `history/${scan.id}/userReaction`), newReaction);

    // Update state
    setHistory(prev =>
      prev.map(h =>
        h.id === scan.id
          ? { ...h, likes: updatedLikes, dislikes: updatedDislikes, userReaction: newReaction }
          : h
      )
    );
  };

  // Toggle comment input
  const toggleCommentInput = (scan: ScanResult) => {
    setHistory(prev =>
      prev.map(h =>
        h.id === scan.id ? { ...h, showCommentInput: !h.showCommentInput } : h
      )
    );
  };

  // Submit comment
  const submitComment = async (scan: ScanResult) => {
    if (!scan.newComment?.trim()) return;
    const updatedComments = await addComment(scan.url, scan.newComment);

    setHistory(prev =>
      prev.map(h =>
        h.id === scan.id
          ? { ...h, comments: updatedComments, newComment: '', showCommentInput: false }
          : h
      )
    );
  };

  return (
    <div className="community-app">
      <main className="glass-card">
        <h1>Community Features</h1>
        <p>Community-driven reports, discussions, and trusted links will appear here.</p>
      </main>

      <div className="top-bar">
  <button className="back-btn" onClick={() => navigate('/')}>
    ← Back
  </button>
</div>


      <div className="search-bar">
        <input
          type="text"
          placeholder="Search links..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button>🔍</button>
      </div>

      <section className="history-section">
        <div className="history-head">
          <div>Recent checks</div>
          <button className="clear-btn" disabled>Clear</button>
        </div>

        <div className="history-list">
          {filteredHistory.length === 0 ? (
            <div className="empty-history">No checks yet</div>
          ) : (
            filteredHistory.map(scan => (
              <div key={scan.id} className="history-item">
                <div className="h-url">{scan.url.replace(/^https?:\/\//, '')}</div>

                <div className="result-reactions">
                  <div
                    className="result-score-inline"
                    style={{ backgroundColor: scan.color }}
                  >
                    {scan.safety}
                  </div>

                  <button
                    className={`reaction-btn ${scan.userReaction === 'like' ? 'liked' : ''}`}
                    onClick={() => handleLike(scan)}
                  >
                    👍 {scan.likes ?? 0}
                  </button>

                  <button
                    className={`reaction-btn ${scan.userReaction === 'dislike' ? 'disliked' : ''}`}
                    onClick={() => handleDislike(scan)}
                  >
                    👎 {scan.dislikes ?? 0}
                  </button>

                  <button
                    className="reaction-btn comment-btn"
                    onClick={() => toggleCommentInput(scan)}
                  >
                    💬 {scan.comments?.length ?? 0}
                  </button>
                </div>

                {scan.showCommentInput && (
                  <div className="comment-box">
                    <input
                      type="text"
                      placeholder="Add a comment..."
                      value={scan.newComment ?? ''}
                      onChange={(e) =>
                        setHistory(prev =>
                          prev.map(h =>
                            h.id === scan.id ? { ...h, newComment: e.target.value } : h
                          )
                        )
                      }
                    />
                    <button onClick={() => submitComment(scan)}>Comment</button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
