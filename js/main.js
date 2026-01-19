// ✅ Riot API Key (개발용 / 노출되면 재발급 권장)
const RIOT_API_KEY = "";

// ✅ ASIA 고정
const REGION = "asia";
const STORAGE_KEY = "riotSearchPayload";

// ===== Data Dragon (Champion square icons) =====
let DD_VERSION = null;                  // 예: "16.1.1"
let CHAMP_IMG_BY_KEY = new Map();       // championId(숫자) -> "Aatrox.png"

async function loadDataDragonChampionMap() {
  if (DD_VERSION && CHAMP_IMG_BY_KEY.size) return; // 이미 로드됨

  // 1) 최신 버전 가져오기
  const versions = await fetch("https://ddragon.leagueoflegends.com/api/versions.json")
    .then(r => r.json());
  DD_VERSION = versions[0];

  // 2) 챔피언 목록(이미지 파일명 포함) 가져오기
  const champJsonUrl = `https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/data/en_US/champion.json`;
  const champJson = await fetch(champJsonUrl).then(r => r.json());

  // champJson.data = { Aatrox: { key:"266", image:{ full:"Aatrox.png" }, ... }, ... }
  for (const champName in champJson.data) {
    const c = champJson.data[champName];
    if (c?.key && c?.image?.full) {
      CHAMP_IMG_BY_KEY.set(String(c.key), c.image.full);
    }
  }
}

function getChampionSquareUrlByChampionId(championId) {
  const file = CHAMP_IMG_BY_KEY.get(String(championId));
  if (!file || !DD_VERSION) return null;
  return `https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/img/champion/${file}`;
}


const $ = (id) => document.getElementById(id);

let matchMap = new Map();   // matchId -> matchJson
let currentPuuid = null;    // 클릭 시 사용

function baseUrl() {
  return `https://${REGION}.api.riotgames.com`;
}

function setStatus(msg) {
  const el = $("status");
  if (el) el.textContent = msg;
}

async function riotFetchJson(url) {
  const res = await fetch(url, {
    method: "GET",
    headers: { "X-Riot-Token": RIOT_API_KEY },
  });

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  if (!res.ok) {
    const retryAfter = res.headers.get("Retry-After");
    throw { status: res.status, statusText: res.statusText, retryAfter, url, data };
  }
  return data;
}

async function getMatchDetail(matchId) {
  const url = `${baseUrl()}/lol/match/v5/matches/${encodeURIComponent(matchId)}`;
  return riotFetchJson(url);
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function formatDate(ms) {
  const d = new Date(ms);
  return d.toLocaleString();
}

function pickMe(matchJson, puuid) {
  const participants = matchJson?.info?.participants ?? [];
  return participants.find((p) => p.puuid === puuid) ?? null;
}

function summarize(matches, puuid) {
  let games = 0, wins = 0, k = 0, d = 0, a = 0;

  for (const m of matches) {
    const me = pickMe(m, puuid);
    if (!me) continue;
    games++;
    if (me.win) wins++;
    k += me.kills ?? 0;
    d += me.deaths ?? 0;
    a += me.assists ?? 0;
  }

  const winRate = games ? (wins / games) * 100 : 0;
  const avg = (x) => (games ? x / games : 0);

  return {
    games,
    wins,
    losses: games - wins,
    winRate: Number(winRate.toFixed(1)),
    avgKills: Number(avg(k).toFixed(2)),
    avgDeaths: Number(avg(d).toFixed(2)),
    avgAssists: Number(avg(a).toFixed(2)),
    avgKDA: Number(((k + a) / Math.max(1, d)).toFixed(2)),
  };
}

// 레이트리밋 보호: 동시 요청 제한
async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await mapper(items[cur], cur);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

function renderSummary(sum) {
  const el = $("summary");
  if (!el) return;

  el.textContent =
    `총 ${sum.games}판 | ${sum.wins}승 ${sum.losses}패 | 승률 ${sum.winRate}% | ` +
    `평균 K/D/A ${sum.avgKills}/${sum.avgDeaths}/${sum.avgAssists} | 평균 KDA ${sum.avgKDA}`;
}

function renderMatchCard(matchJson, puuid, matchId) {
  const info = matchJson.info;
  const me = pickMe(matchJson, puuid);

  const div = document.createElement("div");
  div.className = "match " + (me?.win ? "win" : "lose");
  div.dataset.matchId = matchId; // ✅ 클릭 시 matchId로 찾기

  if (!me) {
    div.innerHTML = `
      <div><b>${matchId}</b></div>
      <div class="muted">내 참가자 정보를 찾지 못했습니다.</div>
      <div class="extra" data-loaded="0" style="display:none;"></div>
    `;
    return div;
  }
  
  const champIconUrl = getChampionSquareUrlByChampionId(me.championId);
  const champ = me.championName ?? `ChampionId:${me.championId ?? "?"}`;
  const kdaText = `${me.kills}/${me.deaths}/${me.assists}`;
  const lane = me.teamPosition || me.lane || "-";
  const duration = formatDuration(info.gameDuration ?? 0);
  const when = info.gameEndTimestamp ? formatDate(info.gameEndTimestamp) : "-";
  const mode = info.gameMode ?? "-";

  div.innerHTML = `
    <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
      <div class="titleRow">
        ${champIconUrl ? `<img class="champIcon" src="${champIconUrl}" alt="${champ}">` : ""}
        <div><b>${me.win ? "WIN" : "LOSE"}</b> · ${champ} · ${kdaText}</div>
      </div>
      <div class="muted">${mode} · ${lane} · ${duration}</div>
    </div>
    <div class="muted" style="margin-top:6px;">${when}</div>

    <!-- ✅ 클릭 시 여기 아래에 스탯이 펼쳐짐 -->
    <div class="extra" data-loaded="0" style="display:none;"></div>
  `;

  return div;
}

function loadPayloadOrRedirect() {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    window.location.assign("./search.html");
    return null;
  }
  return JSON.parse(raw);
}

/* ===== 클릭 시 펼쳐서 보여줄 스탯 ===== */

function formatNumber(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return Number(n).toFixed(digits);
}

function formatPercent(p) {
  if (p === null || p === undefined || Number.isNaN(p)) return "-";
  const v = Number(p);
  const percent = v <= 1 ? v * 100 : v;
  return `${percent.toFixed(1)}%`;
}

function getTotalPingsFromMatch(matchJson, puuid) {
  const me = pickMe(matchJson, puuid);
  if (!me) return { totalPings: 0, pingBreakdown: {} };

  // ParticipantDto에 있는 "*Pings" 필드를 전부 합산
  const pingKeys = Object.keys(me).filter(
    (k) => k.endsWith("Pings") && Number.isFinite(me[k])
  );

  const pingBreakdown = {};
  let total = 0;

  for (const k of pingKeys) {
    const v = Number(me[k]) || 0;
    pingBreakdown[k] = v;
    total += v;
  }

  return { totalPings: total, pingBreakdown };
}

function extractSelectedStats(matchJson, puuid) {
  const me = pickMe(matchJson, puuid);
  if (!me) return null;

  const totalDamageTaken = me.totalDamageTaken;
  const { totalPings, pingBreakdown } = getTotalPingsFromMatch(matchJson, puuid);

  const ch = me.challenges || {};
  const goldEarned = me.goldEarned;
  const goldSpent = me.goldSpent;

  const laneMinionsFirst10Minutes =
    ch.laneMinionsFirst10Minutes ?? me.laneMinionsFirst10Minutes ?? null;

  const damageTakenOnTeamPercentage =
    ch.damageTakenOnTeamPercentage ?? me.damageTakenOnTeamPercentage ?? null;

  const damagePerMinute =
    ch.damagePerMinute ?? me.damagePerMinute ?? null;

  const kda =
    me.kda ?? ch.kda ??
    ((Number(me.kills ?? 0) + Number(me.assists ?? 0)) / Math.max(1, Number(me.deaths ?? 0)));

  return {
    goldEarned,
    goldSpent,
    laneMinionsFirst10Minutes,
    damageTakenOnTeamPercentage,
    kda,
    damagePerMinute,
    totalDamageTaken,
    totalPings,
    pingBreakdown
  };
}

function renderExtraStats(extraEl, stats) {
  if (!stats) {
    extraEl.innerHTML = `<div class="muted">스탯을 불러올 수 없습니다.</div>`;
    return;
  }

  extraEl.innerHTML = `
    <div class="extraGrid">
      <div class="kv"><b>goldEarned</b><span>${stats.goldEarned ?? "-"}</span></div>
      <div class="kv"><b>goldSpent</b><span>${stats.goldSpent ?? "-"}</span></div>

      <div class="kv"><b>laneMinionsFirst10Minutes</b><span>${formatNumber(stats.laneMinionsFirst10Minutes, 1)}</span></div>
      <div class="kv"><b>damageTakenOnTeamPercentage</b><span>${formatPercent(stats.damageTakenOnTeamPercentage)}</span></div>

      <div class="kv"><b>kda</b><span>${formatNumber(stats.kda, 2)}</span></div>
      <div class="kv"><b>damagePerMinute</b><span>${formatNumber(stats.damagePerMinute, 1)}</span></div>
      <div class="kv"><b>totalDamageTaken</b><span>${formatNumber(stats.totalDamageTaken, 1)}</span></div>
      <div class="kv"><b>totalPings</b><span>${stats.totalPings ?? "-"}</span></div>
    </div>
  `;
}

/* ===== 메인 로직 ===== */

async function init() {
  const payload = loadPayloadOrRedirect();
  if (!payload) return;

  if (!RIOT_API_KEY || !RIOT_API_KEY.startsWith("RGAPI-")) {
    setStatus("API Key 설정 필요");
    const s = $("summary");
    if (s) s.textContent = "main.js 상단 RIOT_API_KEY를 설정해 주세요.";
    return;
  }

  $("riotId").textContent = payload.riotId ?? "-";
  $("createdAt").textContent = payload.createdAt ?? "-";

  const matchIds = payload.matchIds ?? [];
  currentPuuid = payload.puuid;

  if (!matchIds.length || !currentPuuid) {
    setStatus("데이터 없음");
    $("summary").textContent = "matchIds 또는 puuid가 없습니다. 다시 검색해 주세요.";
    return;
  }

  try {
    setStatus("매치 상세 로딩 중...");

    // ✅ 여기서는 그냥 상세만 받아온다
    const details = await mapWithConcurrency(matchIds, 3, (matchId) => getMatchDetail(matchId));
    await loadDataDragonChampionMap();

    // ✅ 받은 뒤에 matchId -> matchJson 맵을 만든다 (중요!)
    matchMap = new Map();
    details.forEach((m, idx) => matchMap.set(matchIds[idx], m));

    setStatus("렌더링 중...");

    const sum = summarize(details, currentPuuid);
    renderSummary(sum);

    const container = $("matches");
    container.innerHTML = "";
    const frag = document.createDocumentFragment();

    details.forEach((matchJson, idx) => {
      frag.appendChild(renderMatchCard(matchJson, currentPuuid, matchIds[idx]));
    });

    container.appendChild(frag);

    // ✅ 클릭 이벤트는 렌더링 후 1번만 붙이면 됨
// ✅ 클릭 시: 한 번에 한 경기만 펼치기
    container.addEventListener("click", (e) => {
      const card = e.target.closest(".match");
      if (!card) return;

      const matchId = card.dataset.matchId;
      const extra = card.querySelector(".extra");
      if (!extra) return;

      // 토글
      const willOpen = extra.style.display !== "block";
      extra.style.display = willOpen ? "block" : "none";

      // 열 때만, 아직 안 채웠으면 채우기
      if (willOpen && extra.dataset.loaded !== "1") {
        const matchJson = matchMap.get(matchId);
        const stats = extractSelectedStats(matchJson, currentPuuid);
        renderExtraStats(extra, stats);
        extra.dataset.loaded = "1";
      }
    });



    setStatus("완료");
  } catch (err) {
    setStatus("실패");
    $("summary").textContent = `에러: ${err?.status ?? ""} ${err?.statusText ?? ""}`;

    const container = $("matches");
    container.innerHTML = `<div class="muted mono">${JSON.stringify(err, null, 2)}</div>`;

    if (err?.status === 429) {
      $("summary").textContent += ` (Retry-After: ${err.retryAfter ?? "?"}s)`;
    }
  }
}

$("back")?.addEventListener("click", () => {
  sessionStorage.removeItem(STORAGE_KEY);
  window.location.assign("./search.html");
});

init();
