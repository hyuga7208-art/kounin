/* みんなの学習状況：一緒に勉強している友だちと、学習の進み具合をリアルタイムで見せ合う
   Firebase Realtime Database（REST と EventSource）に、合言葉ごとのグループで各自の状況を置く。
   送るもの：ニックネーム、科目ごとの要約、回ごとの結果（問題ごとの○×・周回の点数・苦手の数）、
             いま解いている問題、今日の解答数、最近の解答
   index.html と各科目のページ（data-subj 付き）で読み込む。
   科目のページでは、メインの script の関数（renderQ・show・check・el・markSvg・qname など）を包んで使い、
   回の一覧に友だちの一覧を、#friend に友だちの詳しい状況の画面を作る。 */
(() => {
  const DB = "https://kounin-5fbc8-default-rtdb.asia-southeast1.firebasedatabase.app/";   // 空のときは、この機能を出さない
  const KEY = "kounin-share-v1";   // この端末の参加情報 { code, id, name, dirty: [送れていない科目], day: { d, n, ok }, recent: [最近の解答] }
  const SUBJECTS = { math: ["数学", "kounin-math-all-v2"], physics: ["物理基礎", "kounin-physics-all-v1"], chemistry: ["化学基礎", "kounin-chemistry-all-v1"] };
  const EXAMS = ["r7-1", "r7-2", "r6-1", "r6-2", "r5-1", "r5-2", "r4-1", "r4-2", "r3-1", "r3-2", "r2-1", "r2-2"], PER = 20;   // 過去問の回（要約はこの12回で数える）
  const LIVE = 150000;   // 最後の知らせからこれ以上たったら「いま解いています」を出さない（ミリ秒）
  const BEAT = 60000;    // 解いている間、この間隔で知らせ直す（ミリ秒）
  const ABC = "abcdefghijkmnpqrstuvwxyz23456789", CODE = /^[a-km-np-z2-9]{10}$/, ID = /^[a-km-np-z2-9]{16}$/;
  const base = DB.replace(/\/+$/, "");
  const rid = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => ABC[b % 32]).join("");
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

  function me(){
    try { const m = JSON.parse(localStorage.getItem(KEY) || "null"); return m && CODE.test(m.code) && ID.test(m.id) && m.name ? m : null; }
    catch (e){ return null; }
  }
  function setMe(m){ try { if (m) localStorage.setItem(KEY, JSON.stringify(m)); else localStorage.removeItem(KEY); } catch (e) {} }
  const url = path => `${base}/groups/${path.join("/")}.json`;
  async function req(method, path, body, keepalive){
    const r = await fetch(url(path), { method, body: body === undefined ? undefined : JSON.stringify(body), keepalive: !!keepalive });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  /* ---------- 送るもの：端末に保存されている記録から作る ---------- */
  function stored(subj){ try { const s = JSON.parse(localStorage.getItem(SUBJECTS[subj][1]) || "null"); return (s && s.exams) || {}; } catch (e){ return {}; } }
  const lapsOf = e => (e && Array.isArray(e.laps)) ? e.laps : [];
  function summary(subj){
    const ex = stored(subj);
    const counts = EXAMS.map(k => lapsOf(ex[k]).length), lap = Math.min(...counts) + 1;
    let done = 0, ok = 0, weak = 0;
    for (const k of EXAMS){
      const e = ex[k]; if (!e) continue;
      for (const r of Object.values(e.results || {})){ done++; if (r === "ok") ok++; }
      weak += Object.keys(e.weak || {}).length;
    }
    return { lap, cleared: counts.filter(c => c >= lap).length, full: EXAMS.filter(k => lapsOf(ex[k]).some(l => l && l.score >= 100)).length,
             laps: counts.reduce((a, b) => a + b, 0), done, ok, weak, total: EXAMS.length * PER };
  }
  // 回ごとの結果：r = 問題ごとの○×（1 / 0。最後に解いたときの結果）、p = 周回の点数（新しい10周）、w = 苦手の数
  // 要約（上の summary）は過去問の12回だけで数えるが、回ごとの結果はオリジナル問題の回（x-1 など）も送る
  function detail(subj){
    const ex = stored(subj), out = {};
    for (const k of Object.keys(ex)){
      const e = ex[k]; if (!e || !/^[a-z0-9-]{1,8}$/i.test(k)) continue;
      const r = {};
      for (const [id, v] of Object.entries(e.results || {})) if (/^[0-9a-z-]{1,8}$/i.test(id)) r[id] = v === "ok" ? 1 : 0;
      const p = lapsOf(e).map(l => l && +l.score).filter(Number.isFinite).slice(-10), w = Object.keys(e.weak || {}).length;
      if (Object.keys(r).length || p.length || w) out[k] = { r, p, w };
    }
    return out;
  }
  const dayOf = m => (m.day && m.day.d === today()) ? m.day : { d: today(), n: 0, ok: 0 };
  async function send(subjs){
    const m = me(); if (!base || !m) return;
    // 要約は項目ごとに書く（科目をまるごと書き換えると、回ごとの結果 ex が一度消えてしまうため）
    const body = { name: m.name, updated: Date.now() };
    for (const s of subjs) for (const [k, v] of Object.entries(summary(s))) body[`${s}/${k}`] = v;
    await req("PATCH", [m.code, m.id], body);
    const now = me(); if (now){ now.dirty = (now.dirty || []).filter(s => !subjs.includes(s)); setMe(now); }
    // 回ごとの結果・今日の解答数・最近の解答は別に送る（データベースのルールが古いままでも、上の要約は届くように）
    const more = { day: dayOf(m), recent: (m.recent || []).slice(0, 10) };
    for (const s of subjs) more[`${s}/ex`] = detail(s);
    await req("PATCH", [m.code, m.id], more).catch(() => {});
  }
  // いま解いている問題（null で消す）
  let nowSent = false;
  async function setNow(v, keepalive){
    const m = me(); if (!base || !m) return;
    try {
      if (v){ await req("PUT", [m.code, m.id, "now"], { ...v, t: Date.now() }, keepalive); nowSent = true; }
      else if (nowSent){ nowSent = false; await req("DELETE", [m.code, m.id, "now"], undefined, keepalive); }
    } catch (e) {}
  }
  async function enter(code, name){
    const m = { code, id: rid(16), name, dirty: [] };
    setMe(m);
    try { await send(Object.keys(SUBJECTS)); } catch (e){ setMe(null); throw e; }
    return m;
  }
  function members(g){
    const m = me();
    return Object.entries(g && typeof g === "object" ? g : {}).filter(([, v]) => v && typeof v === "object").map(([id, v]) => ({ ...v, id, self: !!m && id === m.id }));
  }

  /* ---------- 見張る：グループの変化をすぐ受け取る（EventSource。使えないときは20秒ごとに読み直す） ---------- */
  function watch(cb){
    const m = me(); if (!base || !m) return () => {};
    let data = null, es = null, poll = null, stopped = false;
    const put = (path, v) => {
      const ps = path.split("/").filter(Boolean);
      if (!ps.length){ data = v; return; }
      if (!data || typeof data !== "object") data = {};
      let n = data;
      for (const p of ps.slice(0, -1)){ if (!n[p] || typeof n[p] !== "object") n[p] = {}; n = n[p]; }
      if (v === null) delete n[ps[ps.length - 1]]; else n[ps[ps.length - 1]] = v;
    };
    const fire = () => { if (!stopped) cb(members(data)); };
    const startPoll = () => {
      if (poll || stopped) return;
      const f = () => req("GET", [m.code]).then(g => { data = g; fire(); }).catch(() => {});
      f(); poll = setInterval(f, 20000);
    };
    if (typeof EventSource === "undefined") startPoll();
    else {
      es = new EventSource(url([m.code]));
      es.addEventListener("put", e => { const d = JSON.parse(e.data); put(d.path, d.data); fire(); });
      es.addEventListener("patch", e => { const d = JSON.parse(e.data); for (const [k, v] of Object.entries(d.data || {})) put(`${d.path}/${k}`, v); fire(); });
      es.addEventListener("cancel", () => { es.close(); startPoll(); });
      es.onerror = () => { if (es.readyState === 2) startPoll(); };   // つなぎ直せないときは読み直しに切り替える
    }
    return () => { stopped = true; if (es) es.close(); clearInterval(poll); };
  }

  /* ---------- 表示の手伝い（index.html と科目のページで共通） ---------- */
  const num = x => (Number.isFinite(+x) ? Math.max(0, Math.round(+x)) : 0);
  const listOf = x => Array.isArray(x) ? x : (x && typeof x === "object") ? Object.values(x) : [];
  const name = v => String(v.name || "（名前なし）").slice(0, 20);
  function ago(t){
    const d = new Date(t), now = new Date();
    const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
    return days <= 0 ? `今日 ${hm}` : days === 1 ? `きのう ${hm}` : `${days}日前`;
  }
  const live = v => { const n = v && v.now; return n && typeof n === "object" && Date.now() - num(n.t) < LIVE ? n : null; };
  const where = n => `${SUBJECTS[n.s] ? SUBJECTS[n.s][0] + " " : ""}${String(n.l || "").slice(0, 60)}`;
  function line(v){
    if (!v || typeof v !== "object" || !num(v.done)) return "まだ解いていません";
    return `${num(v.lap)}周目（この周でクリア ${num(v.cleared)}/12回）・解いた ${num(v.done)}/${num(v.total) || 240}問（正解 ${num(v.ok)}）・苦手 ${num(v.weak)}問`;
  }
  const dayText = v => { const d = v && v.day; return d && d.d === today() && num(d.n) ? `今日 ${num(d.n)}問（正解 ${num(d.ok)}）` : "今日はまだ解いていません"; };
  const byRecent = (a, b) => (num(b.updated) - num(a.updated));

  let timer = null;
  const api = {
    enabled: !!base, SUBJECTS, CODE, me, watch,
    fmt: { num, listOf, name, ago, live, where, line, dayText, byRecent },
    // 学習したら少し待ってから送る。送れなかった科目は覚えておき、次に開いたときや保存したときに送り直す
    push(subj){
      const m = me(); if (!base || !m) return;
      if (!(m.dirty || []).includes(subj)){ m.dirty = [...(m.dirty || []), subj]; setMe(m); }
      clearTimeout(timer);
      timer = setTimeout(() => { const d = (me() || {}).dirty || []; if (d.length) send(d).catch(() => {}); }, 2000);
    },
    // 答え合わせした1問を、今日の解答数と最近の解答に入れる（送るのは push のとき）
    answered(e){
      const m = me(); if (!m) return;
      const d = dayOf(m);
      m.day = { d: d.d, n: d.n + 1, ok: d.ok + (e.ok ? 1 : 0) };
      m.recent = [e, ...(m.recent || [])].slice(0, 10);
      setMe(m);
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
    async list(){ const m = me(); return members(await req("GET", [m.code])); }
  };
  window.KouninShare = api;

  const subj = document.currentScript && document.currentScript.dataset.subj;
  if (subj && base && me()) subjectPage(subj);

  /* ---------- 科目のページ ---------- */
  function subjectPage(subj){
    const $ = id => document.getElementById(id);
    if ((me().dirty || []).includes(subj)) api.push(subj);

    // いま解いている問題を知らせる（問題を出したとき・問題画面を離れたとき・画面が裏に回ったとき）
    const nowOf = () => { try { const q = byId[st.run.ids[st.run.i]]; return q ? { s: subj, e: cur, q: String(q.id), l: `${EX[cur].title} ${qname(q)}`.slice(0, 60) } : null; } catch (e){ return null; } };
    const onQuiz = () => !$("quiz").hidden && document.visibilityState === "visible";
    let beat = null;
    const tell = () => {
      const n = onQuiz() ? nowOf() : null;
      clearInterval(beat); beat = null;
      setNow(n, document.visibilityState === "hidden");   // 裏に回るときは、止められても届くように keepalive で送る
      if (n) beat = setInterval(() => { if (onQuiz()) setNow(nowOf()); }, BEAT);
    };
    const origRender = renderQ;
    renderQ = function(){ const r = origRender.apply(this, arguments); tell(); return r; };
    const origShow = show;
    show = function(id){ view.hidden = true; openId = null; const r = origShow.apply(this, arguments); if (id !== "quiz") tell(); return r; };
    document.addEventListener("visibilitychange", tell);
    addEventListener("pagehide", () => setNow(null, true));
    // 答え合わせしたら、今日の解答数と最近の解答に入れる
    const origCheck = check;
    check = function(){
      const r = origCheck.apply(this, arguments);
      try { const q = byId[st.run.ids[st.run.i]]; api.answered({ s: subj, e: cur, q: String(q.id), l: `${EX[cur].title} ${qname(q)}`.slice(0, 60), ok: st.results[q.id] === "ok" ? 1 : 0, t: Date.now() }); } catch (e) {}
      return r;
    };

    // 回の一覧に友だちの一覧、#friend に友だちの詳しい状況
    const css = document.createElement("style");
    css.textContent = `
.fr-box{margin:18px 0 0}
.fr-h{font-size:1.05rem;margin:22px 0 8px}
.fr-box>.fr-h{margin-top:0}
.fr-card{display:grid;gap:2px;width:100%;margin:0 0 8px;padding:10px 12px;text-align:left;background:var(--paper);color:#1D232A;border:1px solid var(--line);border-radius:10px;cursor:pointer;font:inherit}
.fr-name{display:flex;align-items:baseline;gap:8px}
.fr-name b{font-size:1rem;overflow-wrap:anywhere}
.fr-time{margin-left:auto;color:#5B6674;font-size:.78rem;white-space:nowrap}
.fr-live{font-weight:700;font-size:.85rem;margin:4px 0 0}
.fr-live::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:#22A45D;margin-right:6px;vertical-align:1px}
.fr-line{font-size:.82rem;color:#4A5563}
.fr-more{justify-self:end;color:#2E5E99;font-size:.85rem;font-weight:700}
.fr-title{font-size:1.6rem!important}
.fr-rec{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
.fr-rec li{display:grid;grid-template-columns:1.4em 1fr auto;gap:6px;align-items:baseline;padding:6px 2px;border-bottom:1px solid var(--line);font-size:.86rem}
.fr-rec .fr-time{color:var(--muted)}
.fr-ok{color:var(--red);font-weight:700}
.fr-ng{color:var(--muted);font-weight:700}
.fr-ex{margin:0 0 8px;background:var(--paper);color:#1D232A;border:1px solid var(--line);border-radius:10px;padding:0 10px}
.fr-ex>summary{display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:10px 2px;cursor:pointer;list-style:none}
.fr-ex>summary::-webkit-details-marker{display:none}
.fr-ex>summary::after{content:"開く";grid-column:2;grid-row:1;font-size:.78rem;color:#2E5E99;font-weight:700}
.fr-ex[open]>summary::after{content:"たたむ"}
.fr-meta{grid-column:1/-1;font-size:.82rem;color:#4A5563}
.fr-ex .map{margin:0 0 10px}
.fr-ex .dai{border-bottom-color:#D3DDEA}
.fr-ex .dai-no{border-color:#1D232A;color:#1D232A}
.fr-cell{display:inline-grid;place-items:center;cursor:default}`;
    document.head.append(css);
    const box = el("section", { class: "fr-box", id: "frBox", "aria-label": "みんなの学習状況" });
    $("waBox").after(box);
    const view = el("main", { class: "wrap home sub-home", id: "friend", hidden: "" });
    $("result").after(view);
    let MS = [], openId = null, first = true;

    function renderList(){
      box.textContent = "";
      box.append(el("h2", { class: "fr-h", text: `みんなの学習状況（${SUBJECTS[subj][0]}）` }));
      const others = MS.filter(v => !v.self).sort(byRecent);
      if (!others.length) box.append(el("p", { class: "wa-note", text: "まだ友だちが参加していません。" }));
      for (const v of others){
        const n = live(v);
        box.append(el("button", { class: "fr-card", type: "button", onclick: () => openFriend(v.id) },
          el("span", { class: "fr-name" }, el("b", { text: name(v) }), v.updated ? el("span", { class: "fr-time", text: ago(num(v.updated)) }) : null),
          n ? el("span", { class: "fr-live", text: `いま解いています：${where(n)}` }) : null,
          el("span", { class: "fr-line", text: dayText(v) }),
          el("span", { class: "fr-line", text: line(v[subj]) }),
          el("span", { class: "fr-more", text: "詳しく見る ›" })));
      }
      box.append(el("p", { class: "bk-note" }, el("a", { href: "./#share", style: "color:var(--sheet)", text: "みんなの学習状況（全科目）を見る ›" })));
    }
    function openFriend(id){
      openId = id;
      for (const s of ["top", "home", "quiz", "result"]) $(s).hidden = true;
      view.hidden = false; window.scrollTo(0, 0);
      renderFriend();
    }
    function renderFriend(){
      const v = MS.find(x => x.id === openId);
      const opened = new Set([...view.querySelectorAll("details[open]")].map(d => d.dataset.k));
      view.textContent = "";
      view.append(el("button", { class: "back toTop", type: "button", onclick: () => { renderTop(); show("top"); } }, "‹ 回の一覧"));
      if (!v){ view.append(el("p", { class: "sub", text: "この人はグループにいません。" })); return; }
      view.append(el("h1", { class: "fr-title", text: `${name(v)}さんの${SUBJECTS[subj][0]}` }));
      const n = live(v);
      view.append(n ? el("p", { class: "fr-live", text: `いま解いています：${where(n)}` }) : el("p", { class: "sub", text: v.updated ? `最後に勉強：${ago(num(v.updated))}` : "" }));
      view.append(el("p", { class: "sub", text: dayText(v) }), el("p", { class: "sub", text: line(v[subj]) }));
      const rec = listOf(v.recent).filter(r => r && typeof r === "object").slice(0, 10);
      if (rec.length){
        const ul = el("ul", { class: "fr-rec" });
        for (const r of rec) ul.append(el("li", {}, el("span", { class: r.ok ? "fr-ok" : "fr-ng", text: r.ok ? "○" : "×" }), el("span", { text: where(r) }), el("span", { class: "fr-time", text: ago(num(r.t)) })));
        view.append(el("h2", { class: "fr-h", text: "最近の解答（全科目）" }), ul);
      }
      view.append(el("h2", { class: "fr-h", text: "回ごとの結果" }));
      const exd = (v[subj] && typeof v[subj] === "object" && v[subj].ex) || {};
      for (const y of YEARS) for (const k of y.keys){
        const E = EX[k], d = (exd[k] && typeof exd[k] === "object") ? exd[k] : {}, r = (d.r && typeof d.r === "object") ? d.r : {}, p = listOf(d.p).map(num);
        const done = E.Q.filter(q => q.id in r).length, ok = E.Q.filter(q => +r[q.id] === 1).length;
        const meta = [p.length ? `${p.length}周・最高${Math.max(...p)}点` : "", done ? `解いた ${done}/${E.Q.length}問（正解 ${ok}）` : "まだ解いていません", num(d.w) ? `苦手 ${num(d.w)}問` : ""].filter(Boolean).join("・");
        view.append(el("details", { class: "fr-ex", "data-k": k, open: opened.has(k) ? "" : null },
          el("summary", {}, el("b", { text: E.title }), el("span", { class: "fr-meta", text: meta })), friendMap(E, r)));
      }
    }
    // 問題ごとの○×（その回の問題一覧と同じ並び）
    function friendMap(E, r){
      const map = el("div", { class: "map" });
      for (const d of [...new Set(E.Q.map(q => q.dai))]){
        const cells = el("div", { class: "cells" });
        for (const q of E.Q.filter(q => q.dai === d)){
          const v = q.id in r ? +r[q.id] : null;
          const c = el("span", { class: "cell fr-cell" + (v === 0 ? " ng" : ""), "aria-label": `${qname(q)} ${v === 1 ? "正解" : v === 0 ? "不正解" : "まだ解いていない"}` }, q.sho != null ? `(${q.sho})` : toiName(q));
          if (v === 1 || v === 0) c.append(markSvg(v === 1));
          cells.append(c);
        }
        map.append(el("div", { class: "dai" }, el("span", { class: "dai-no", text: String(d) }), cells, el("span", { class: "dai-pts" })));
      }
      return map;
    }
    const update = ms => {
      MS = ms;
      renderList();
      if (openId && !view.hidden) renderFriend();
      if (first && ms.length){
        first = false;
        const h = location.hash.match(/^#friend=([a-km-np-z2-9]{16})$/);
        if (h){ history.replaceState(null, "", location.pathname); openFriend(h[1]); }
      }
    };
    watch(update);
    addEventListener("hashchange", () => { const h = location.hash.match(/^#friend=([a-km-np-z2-9]{16})$/); if (h){ history.replaceState(null, "", location.pathname); openFriend(h[1]); } });
    setInterval(() => update(MS), 20000);   // 「いま解いています」「今日 ○:○○」を時間に合わせて直す
    renderList();
  }
})();
