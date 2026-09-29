/* みんなの学習状況：一緒に勉強している友だちと、学習の進み具合を見せ合う
   Firebase Realtime Database（REST）に、合言葉ごとのグループで、各自の要約だけを置く。
   送るのはニックネームと科目ごとの要約（周回・解いた問題数・正解数・苦手の数）と最後に勉強した時刻だけ。
   どの問題を間違えたかなどの記録そのものは送らない。
   index.html と各科目のページ（data-subj 付き）で読み込む。 */
(() => {
  const DB = "";   // Firebase Realtime Database の URL。空のときは、この機能を出さない
  const KEY = "kounin-share-v1";   // この端末の参加情報 { code: 合言葉, id: メンバーID, name: ニックネーム, dirty: [送れていない科目] }
  const SUBJECTS = { math: ["数学", "kounin-math-all-v2"], physics: ["物理基礎", "kounin-physics-all-v1"], chemistry: ["化学基礎", "kounin-chemistry-all-v1"] };
  const EXAMS = ["r7-1", "r7-2", "r6-1", "r6-2", "r5-1", "r5-2", "r4-1", "r4-2", "r3-1", "r3-2", "r2-1", "r2-2"], PER = 20;
  const ABC = "abcdefghijkmnpqrstuvwxyz23456789", CODE = /^[a-km-np-z2-9]{10}$/, ID = /^[a-km-np-z2-9]{16}$/;
  const base = DB.replace(/\/+$/, "");
  const rid = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => ABC[b % 32]).join("");

  function me(){
    try { const m = JSON.parse(localStorage.getItem(KEY) || "null"); return m && CODE.test(m.code) && ID.test(m.id) && m.name ? m : null; }
    catch (e){ return null; }
  }
  function setMe(m){ try { if (m) localStorage.setItem(KEY, JSON.stringify(m)); else localStorage.removeItem(KEY); } catch (e) {} }
  async function req(method, path, body){
    const r = await fetch(`${base}/groups/${path.join("/")}.json`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  // 科目の要約：端末に保存されている記録から数える
  function summary(subj){
    let s = null; try { s = JSON.parse(localStorage.getItem(SUBJECTS[subj][1]) || "null"); } catch (e) {}
    const ex = (s && s.exams) || {};
    const laps = k => (ex[k] && Array.isArray(ex[k].laps)) ? ex[k].laps : [];
    const counts = EXAMS.map(k => laps(k).length), lap = Math.min(...counts) + 1;
    let done = 0, ok = 0, weak = 0;
    for (const k of EXAMS){
      const e = ex[k]; if (!e) continue;
      for (const r of Object.values(e.results || {})){ done++; if (r === "ok") ok++; }
      weak += Object.keys(e.weak || {}).length;
    }
    return { lap, cleared: counts.filter(c => c >= lap).length, full: EXAMS.filter(k => laps(k).some(l => l && l.score >= 100)).length,
             laps: counts.reduce((a, b) => a + b, 0), done, ok, weak, total: EXAMS.length * PER };
  }
  async function send(subjs){
    const m = me(); if (!base || !m) return;
    const body = { name: m.name, updated: Date.now() };
    for (const s of subjs) body[s] = summary(s);
    await req("PATCH", [m.code, m.id], body);
    const now = me(); if (now){ now.dirty = (now.dirty || []).filter(s => !subjs.includes(s)); setMe(now); }
  }
  async function enter(code, name){
    const m = { code, id: rid(16), name, dirty: [] };
    setMe(m);
    try { await send(Object.keys(SUBJECTS)); } catch (e){ setMe(null); throw e; }
    return m;
  }

  let timer = null;
  const api = {
    enabled: !!base, SUBJECTS, CODE,
    me,
    // 学習したら少し待ってから送る。送れなかった科目は覚えておき、次に開いたときや保存したときに送り直す
    push(subj){
      const m = me(); if (!base || !m) return;
      if (!(m.dirty || []).includes(subj)){ m.dirty = [...(m.dirty || []), subj]; setMe(m); }
      clearTimeout(timer);
      timer = setTimeout(() => { const d = (me() || {}).dirty || []; if (d.length) send(d).catch(() => {}); }, 2000);
    },
    create: name => enter(rid(10), name),
    async join(code, name){
      code = String(code).trim().toLowerCase();
      if (!CODE.test(code)) throw new Error("code");
      if (!(await req("GET", [code]))) throw new Error("none");
      return enter(code, name);
    },
    // 送れていない科目があれば送る（index.html で一覧を見る前に）
    async flush(){ const d = (me() || {}).dirty || []; if (d.length) await send(d); },
    async rename(name){ const m = me(); await req("PATCH", [m.code, m.id], { name, updated: Date.now() }); m.name = name; setMe(m); },
    async leave(){ const m = me(); if (m) await req("DELETE", [m.code, m.id]); setMe(null); },
    async list(){
      const m = me(), g = (await req("GET", [m.code])) || {};
      return Object.entries(g).filter(([, v]) => v && typeof v === "object").map(([id, v]) => ({ ...v, id, self: id === m.id }));
    }
  };
  window.KouninShare = api;

  // 各科目のページ：送れていない分を送り直し、回の一覧に「みんなの学習状況」へのリンクを出す
  const subj = document.currentScript && document.currentScript.dataset.subj;
  if (subj && base && me()){
    if ((me().dirty || []).includes(subj)) api.push(subj);
    const wa = document.getElementById("waBox");
    if (wa){
      const a = document.createElement("a");
      a.href = "./#share"; a.textContent = "みんなの学習状況を見る ›"; a.style.color = "var(--sheet)";
      const p = document.createElement("p"); p.className = "bk-note"; p.style.margin = "12px 0 0"; p.append(a);
      wa.after(p);
    }
  }
})();
