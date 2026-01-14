// firebase.ts
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set} from "firebase/database";

// 🔐 Your Firebase config (you already have this)
const firebaseConfig = {
  apiKey: "AIzaSyBMy-ZKMNd42ZPkoCdMil9J3GXZ4wdTT8g",
  authDomain: "safelink-959a4.firebaseapp.com",
  databaseURL: "https://safelink-959a4-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "safelink-959a4",
  storageBucket: "safelink-959a4.firebasestorage.app",
  messagingSenderId: "223028851564",
  appId: "1:223028851564:web:86ffab56be485fb97e3949",
};

// 🚀 Initialize Firebase
const app = initializeApp(firebaseConfig);

// 📦 Initialize Realtime Database
export const db = getDatabase(app);

// ------------------------------------
// 👍 LIKE / 👎 DISLIKE FUNCTIONS
// ------------------------------------

// Convert URL to safe Firebase key
function safeKey(url: string) {
  return url.replace(/[.#$/\[\]]/g, "_");
}

// ➕ Add Like
export async function addLike(url: string) {
  const key = safeKey(url);
  const likeRef = ref(db, `links/${key}/likes`);

  const snapshot = await get(likeRef);
  const current = snapshot.val() || 0;

  await set(likeRef, current + 1);
}

// ➕ Add Dislike
export async function addDislike(url: string) {
  const key = safeKey(url);
  const dislikeRef = ref(db, `links/${key}/dislikes`);

  const snapshot = await get(dislikeRef);
  const current = snapshot.val() || 0;

  await set(dislikeRef, current + 1);
}

// 📥 Get Likes
export async function getLikes(url: string): Promise<number> {
  const key = safeKey(url);
  const snapshot = await get(ref(db, `links/${key}/likes`));
  return snapshot.val() || 0;
}

// 📥 Get Dislikes
export async function getDislikes(url: string): Promise<number> {
  const key = safeKey(url);
  const snapshot = await get(ref(db, `links/${key}/dislikes`));
  return snapshot.val() || 0;
}
