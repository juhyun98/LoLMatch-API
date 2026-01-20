// ✅ Riot API Key (노출되면 재발급 권장)
const RIOT_API_KEY = "";

// ✅ ASIA 고정
const REGION = "asia";
const STORAGE_KEY = "riotSearchPayload";

// ===== Data Dragon (Champion square icons) =====
let DD_VERSION = null;
let CHAMP_IMG_BY_KEY = new Map(); // championId(숫자) -> "Aatrox.png"

async function loadDataDragonChampionMap() {
  if (DD_VERSION && CHAMP_IMG_BY_KEY.size) return;

  const versions = await fetch("https://ddragon.leagueoflegends.com/api/versions.json")
    .then((r) => r.json());
  DD_VERSION = versions[0];

  const champJsonUrl = `https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/data/en_US/champion.json`;
  const champJson = await fetch(champJsonUrl).then((r) => r.json());

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
let currentPuuid = null;    // 내 puuid

function baseUrl() {
  return `https://${REGION}.api.riotgames.com`;
}

function setStatus(msg) {
  const el = $("status");
  if (el) el.textContent = msg;
}

async function riotFetchJson(url) {
  if (!RIOT_API_KEY || !RIOT_API_KEY.startsWith("RGAPI-")) {
    throw { status: 0, statusText: "API Key Missing", data: { message: "RIOT_API_KEY를 설정하세요." } };
  }

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
  div.dataset.matchId = matchId;

  if (!me) {
    div.innerHTML = `
      <div><b>${matchId}</b></div>
      <div class="muted">내 참가자 정보를 찾지 못했습니다.</div>
      <div class="extra" style="display:none;"></div>
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

    <div class="extra" style="display:none;"></div>
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

function formatNumber(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return Number(n).toFixed(digits);
}

function getTotalPingsFromMatch(matchJson, puuid) {
  const me = pickMe(matchJson, puuid);
  if (!me) return { totalPings: 0 };

  const pingKeys = Object.keys(me).filter((k) => k.endsWith("Pings") && Number.isFinite(me[k]));
  let total = 0;
  for (const k of pingKeys) total += Number(me[k]) || 0;
  return { totalPings: total };
}

/**
 * ✅ 이제 필요한 5개 지표만 추출
 * - CS@10(라인/정글)
 * - takedownsFirstXMinutes
 * - damagePerMinute(DPM)
 * - visionScorePerMinute(VPM)
 * - totalPings
 */
function extractSelectedStats(matchJson, puuid) {
  const me = pickMe(matchJson, puuid);
  if (!me) return null;

  const position = me.teamPosition || me.individualPosition || me.lane || "UNKNOWN";
  const ch = me.challenges || {};

  const laneMinionsFirst10Minutes =
    ch.laneMinionsFirst10Minutes ?? me.laneMinionsFirst10Minutes ?? null;

  const jungleCsBefore10Minutes =
    ch.jungleCsBefore10Minutes ?? me.jungleCsBefore10Minutes ?? null;

  const takedownsFirstXMinutes =
    ch.takedownsFirstXMinutes ?? me.takedownsFirstXMinutes ?? null;

  const visionScorePerMinute =
    ch.visionScorePerMinute ?? me.visionScorePerMinute ?? null;

  const damagePerMinute =
    ch.damagePerMinute ?? me.damagePerMinute ?? null;

  const goldPerMinute =
    ch.goldPerMinute ?? me.goldPerMinute ?? null;

  const { totalPings } = getTotalPingsFromMatch(matchJson, puuid);

  return {
    position,
    laneMinionsFirst10Minutes,
    jungleCsBefore10Minutes,
    takedownsFirstXMinutes,
    visionScorePerMinute,
    damagePerMinute,
    goldPerMinute,
    totalPings,
  };
}

function renderExtraStats(extraEl, stats) {
  if (!stats) {
    extraEl.innerHTML = `<div class="muted">스탯을 불러올 수 없습니다.</div>`;
    return;
  }

  const isJungle = stats.position === "JUNGLE";
  const csRow = isJungle
    ? `<div class="kv"><b>첫 10분 정글 몬스터 처치 CS</b><span>${formatNumber(stats.jungleCsBefore10Minutes, 1)}</span></div>`
    : `<div class="kv"><b>첫 10분 미니언 CS</b><span>${formatNumber(stats.laneMinionsFirst10Minutes, 1)}</span></div>`;

  extraEl.innerHTML = `
    <div class="extraGrid">
      <div class="kv"><b>10분 전 적 처치관여 횟수</b><span>${formatNumber(stats.takedownsFirstXMinutes, 1)}</span></div>
      <div class="kv"><b>DMG / GOLD</b><span>${(formatNumber(stats.damagePerMinute, 1) / formatNumber(stats.goldPerMinute, 1)).toFixed(2)}</span></div>
      
      <div class="kv"><b>VPM(분당 시야점수)</b><span>${formatNumber(stats.visionScorePerMinute, 1)}</span></div>
      ${csRow}
      <div class="kv"><b>핑 횟수</b><span>${stats.totalPings ?? "-"}</span></div>
    </div>
  `;
}


// ===== 5개 Bar Chart =====
let charts = {};
let chartsInitialized = false;

function createSingleBarChart(canvasId, labelText) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const ctx = canvas.getContext("2d");
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: [labelText],               // ✅ 라벨 1개
      datasets: [{
        label: labelText,
        data: [0],                       // ✅ 값 1개 = 막대 1개
        barThickness: 50,                // ✅ 막대 두께 (원하면 조절)
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true }
      },
    },
  });
}

function initMetricCharts() {
  charts.cs10 = createSingleBarChart("c_cs10", "CS @ 10");
  charts.takedowns = createSingleBarChart("c_takedowns", "takedownsFirstXMinutes");
  charts.dpm = createSingleBarChart("c_dpm", "DPM / GPM");
  charts.vpm = createSingleBarChart("c_vpm", "visionScorePerMinute");
  charts.pings = createSingleBarChart("c_pings", "Pings");
}

function setChartValue(chart, value) {
  if (!chart) return;
  chart.data.datasets[0].data = [Number(value ?? 0)];
  chart.update();
}

function updateMetricCharts(matchJson, stats) {
  // ✅ 정글이면 정글CS, 아니면 라인CS
  const isJungle = stats.position === "JUNGLE";
  const cs10 = isJungle ? stats.jungleCsBefore10Minutes : stats.laneMinionsFirst10Minutes;

  // cs 차트 라벨도 정글/라인에 맞게 바꾸고 싶으면:
  if (charts.cs10) {
    charts.cs10.data.labels = [isJungle ? "Jungle CS @ 10" : "Lane CS @ 10"];
    charts.cs10.data.datasets[0].label = charts.cs10.data.labels[0];
  }

  setChartValue(charts.cs10, cs10);
  setChartValue(charts.takedowns, stats.takedownsFirstXMinutes);
  setChartValue(charts.dpm, stats.damagePerMinute / stats.goldPerMinute);
  setChartValue(charts.vpm, stats.visionScorePerMinute);
  setChartValue(charts.pings, stats.totalPings);

  // 제목 갱신
  const me = pickMe(matchJson, currentPuuid);
  const champ = me?.championName ?? "Unknown";
  const when = matchJson?.info?.gameEndTimestamp ? formatDate(matchJson.info.gameEndTimestamp) : "-";
  const result = me?.win ? "WIN" : "LOSE";
  const titleEl = document.getElementById("chartTitle");
  if (titleEl) titleEl.textContent = `${result} · ${champ} · ${when}`;
}


// ===== 메인 로직 =====

async function init() {
  const payload = loadPayloadOrRedirect();
  if (!payload) return;

  $("riotId").textContent = payload.riotId ?? "-";
  $("createdAt").textContent = payload.createdAt ?? "-";

  const matchIds = payload.matchIds ?? [];
  currentPuuid = payload.puuid;

  if (!matchIds.length || !currentPuuid) {
    setStatus("데이터 없음");
    $("summary").textContent = "matchIds 또는 puuid가 없습니다. 다시 검색해 주세요.";
    return;
  }

  // 차트 영역은 처음엔 숨김(원하면 main.html에서 display:none으로 해도 됨)
  const chartSection = document.getElementById("chartSection");
  if (chartSection) chartSection.style.display = "none";

  try {
    setStatus("매치 상세 로딩 중...");

    const details = await mapWithConcurrency(matchIds, 3, (matchId) => getMatchDetail(matchId));

    // 아이콘 로딩 실패해도 매치 출력은 되게
    try { await loadDataDragonChampionMap(); } catch {}

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

    // ✅ 클릭: 한 번에 한 경기만 펼치기 + 차트(5개 지표) 표시/업데이트 + 스크롤
container.addEventListener("click", (e) => {
  const card = e.target.closest(".match");
  if (!card) return;

  const matchId = card.dataset.matchId;
  const extra = card.querySelector(".extra");
  if (!extra) return;

  const isAlreadyOpen = extra.style.display === "block";

  // 1) 기존 열린 extra 닫기
  container.querySelectorAll(".extra").forEach((el) => (el.style.display = "none"));

  // 2) 같은 경기 다시 클릭하면 차트 숨기고 종료
  if (isAlreadyOpen) {
    if (chartSection) chartSection.style.display = "none";
    return;
  }

  // 3) 클릭한 것만 열기
  extra.style.display = "block";

  const matchJson = matchMap.get(matchId);
  const stats = extractSelectedStats(matchJson, currentPuuid);

  // stats 없으면 차트도 숨김
  if (!stats) {
    renderExtraStats(extra, null);
    if (chartSection) chartSection.style.display = "none";
    return;
  }

  renderExtraStats(extra, stats);

  // 4) 차트 섹션 보여주기
  if (chartSection) chartSection.style.display = "block";

  // ✅ 5) 5개 차트는 최초 1회만 생성 (중요)
  if (!chartsInitialized) {
    initMetricCharts();
    chartsInitialized = true;
  }

  // ✅ 6) 5개 차트 업데이트
  updateMetricCharts(matchJson, stats);

  // 7) 스크롤 이동
  chartSection?.scrollIntoView({ behavior: "smooth", block: "start" });
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
