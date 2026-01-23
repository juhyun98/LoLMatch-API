// ✅ Riot API Key (노출되면 재발급 권장)
const RIOT_API_KEY = "RGAPI-57a12821-c177-4f3a-b642-8dcaf16696cd";

// ✅ ASIA 고정
const REGION = "asia";
const STORAGE_KEY = "riotSearchPayload";

const TIER_BASELINES = {
    IRON: { cs10: 52.15, takedowns: 3.65, DPMGPM: 1.78, vpm: 0.62, pings: 26.24 },
    BRONZE: { cs10: 61.30, takedowns: 3.72, DPMGPM: 1.81, vpm: 0.74, pings: 22.06 },
    SILVER: { cs10: 65.59, takedowns: 3.99, DPMGPM: 1.83, vpm: 0.82, pings: 24.51 },
    GOLD: { cs10: 66.13, takedowns: 3.91, DPMGPM: 1.88, vpm: 0.79, pings: 24.73 },
    PLATINUM: { cs10: 68.23, takedowns: 4.40, DPMGPM: 1.94, vpm: 0.85, pings: 27.02 },
    EMERALD: { cs10: 70.53, takedowns: 4.77, DPMGPM: 2.01, vpm: 0.89, pings: 33.11 },
    DIAMOND: { cs10: 73.37, takedowns: 5.01, DPMGPM: 1.84, vpm: 0.86, pings: 31.55 },
    MASTER: { cs10: 75.84, takedowns: 5.31, DPMGPM: 1.73, vpm: 0.96, pings: 36.44 },
    GRANDMASTER: { cs10: 79.32, takedowns: 3.92, DPMGPM: 1.87, vpm: 1.02, pings: 42.48 },
    CHALLENGER: { cs10: 82.27, takedowns: 4.22, DPMGPM: 1.89, vpm: 1.14, pings: 44.57 },
};

const TIER_COLORS = {
    IRON: "#A19D94",
    BRONZE: "#A06B51",
    SILVER: "#B1C1C0",
    GOLD: "#EABB4F",
    PLATINUM: "#42c2a2",
    EMERALD: "#46cd83",
    DIAMOND: "#4fa5dc",
    MASTER: "#b73bc2",
    GRANDMASTER: "#E84040",
    CHALLENGER: "#49E9F0"
};

function getBaselineColor(tier) {
    return TIER_COLORS[tier] ?? "rgba(255,255,255,0.6)";
}

let selectedBaselineName = null; // "IRON" | "SILVER" | ...


let selectedBaseline = null; // { name: "IRON", values: Iron } 또는 null
let lastSelectedMatchJson = null;
let lastSelectedStats = null;
let recent10Avg = null; // { cs10Lane, cs10Jungle, takedowns, DPMGPM, vpm, pings }


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
        window.location.assign("./index.html");
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

function renderExtraStats(extraEl, matchJson) {
    if (!matchJson) {
        extraEl.innerHTML = `<div class="muted">데이터를 불러올 수 없습니다.</div>`;
        return;
    }

    // 1. 기존의 텍스트 지표(CS, 핑 등)는 유지하고 싶다면 기존 로직을 먼저 실행
    const stats = extractSelectedStats(matchJson, currentPuuid); // 기존 데이터 추출

    // 텍스트 그리드 생성 (기존 로직 유지)
    const isJungle = stats.position === "JUNGLE";
    const csRow = isJungle
        ? `<div class="kv"><b>첫 10분 정글 몬스터 처치 CS</b><span>${formatNumber(stats.jungleCsBefore10Minutes, 1)}</span></div>`
        : `<div class="kv"><b>첫 10분 미니언 CS</b><span>${formatNumber(stats.laneMinionsFirst10Minutes, 1)}</span></div>`;

    extraEl.innerHTML = `
        <div class="extraGrid">
            ${csRow}
            <div class="kv"><b>10분 전 적 처치관여 횟수</b><span>${formatNumber(stats.takedownsFirstXMinutes, 1)}</span></div>
            <div class="kv"><b>DMG / GOLD</b><span>${(formatNumber(stats.damagePerMinute, 1) / formatNumber(stats.goldPerMinute, 1)).toFixed(2)}</span></div>
            <div class="kv"><b>VPM(분당 시야점수)</b><span>${formatNumber(stats.visionScorePerMinute, 1)}</span></div>
            <div class="kv"><b>핑 횟수</b><span>${stats.totalPings ?? "-"}</span></div>
        </div>
        <hr style="border: 0; border-top: 1px dashed rgba(255,255,255,0.2); margin: 15px 0;">
        <div class="inner-graph-container"></div> `;

    // 2. 추가된 컨테이너에 그래프 그리기
    const target = extraEl.querySelector(".inner-graph-container");
    drawMatchDetailGraphs(target, matchJson);
}

function toFiniteNumber(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
}

function computeRecent10Averages(matches, puuid) {
    const acc = {
        cs10LaneSum: 0, cs10LaneCnt: 0,
        cs10JgSum: 0, cs10JgCnt: 0,
        takedownsSum: 0, takedownsCnt: 0,
        dpmgpmSum: 0, dpmgpmCnt: 0,
        vpmSum: 0, vpmCnt: 0,
        pingsSum: 0, pingsCnt: 0,
    };

    for (const m of matches) {
        const s = extractSelectedStats(m, puuid);
        if (!s) continue;

        const isJungle = s.position === "JUNGLE";

        const laneCs = toFiniteNumber(s.laneMinionsFirst10Minutes);
        const jgCs = toFiniteNumber(s.jungleCsBefore10Minutes);

        if (isJungle) {
            if (jgCs !== null) { acc.cs10JgSum += jgCs; acc.cs10JgCnt++; }
        } else {
            if (laneCs !== null) { acc.cs10LaneSum += laneCs; acc.cs10LaneCnt++; }
        }

        const tk = toFiniteNumber(s.takedownsFirstXMinutes);
        if (tk !== null) { acc.takedownsSum += tk; acc.takedownsCnt++; }

        const dpm = toFiniteNumber(s.damagePerMinute);
        const gpm = toFiniteNumber(s.goldPerMinute);
        if (dpm !== null && gpm !== null && gpm > 0) {
            acc.dpmgpmSum += (dpm / gpm);
            acc.dpmgpmCnt++;
        }

        const vpm = toFiniteNumber(s.visionScorePerMinute);
        if (vpm !== null) { acc.vpmSum += vpm; acc.vpmCnt++; }

        const p = toFiniteNumber(s.totalPings);
        if (p !== null) { acc.pingsSum += p; acc.pingsCnt++; }
    }

    const avg = (sum, cnt) => (cnt ? (sum / cnt) : 0);

    return {
        cs10Lane: avg(acc.cs10LaneSum, acc.cs10LaneCnt),
        cs10Jungle: avg(acc.cs10JgSum, acc.cs10JgCnt),
        takedowns: avg(acc.takedownsSum, acc.takedownsCnt),
        DPMGPM: avg(acc.dpmgpmSum, acc.dpmgpmCnt),
        vpm: avg(acc.vpmSum, acc.vpmCnt),
        pings: avg(acc.pingsSum, acc.pingsCnt),
    };
}



function drawMatchDetailGraphs(targetContainer, matchJson) {
    targetContainer.innerHTML = "";
    const participants = matchJson.info.participants;

    const metrics = [
        { key: 'kills', label: '챔피언 처치' },
        { key: 'goldEarned', label: '골드 획득량' },
        { key: 'totalDamageDealtToChampions', label: '가한 피해량' },
        { key: 'wardsPlaced', label: '와드 설치' },
        { key: 'totalDamageTaken', label: '받은 피해량' },
        { key: 'totalMinionsKilled', label: 'CS' }
    ];

    const grid = document.createElement("div");
    grid.className = "team-analysis-grid";

    metrics.forEach(metric => {
        const itemDiv = document.createElement("div");
        itemDiv.className = "analysis-item";

        const blueTeam = participants.filter(p => p.teamId === 100);
        const redTeam = participants.filter(p => p.teamId === 200);
        const blueTotal = blueTeam.reduce((sum, p) => sum + (p[metric.key] || 0), 0);
        const redTotal = redTeam.reduce((sum, p) => sum + (p[metric.key] || 0), 0);
        const maxVal = Math.max(...participants.map(p => p[metric.key] || 0));

        let html = `<div class="analysis-title">${metric.label}</div>`;
        // ✅ 핵심: CSS와 연결되는 comparison-container 추가
        html += `<div class="comparison-container">`;

        // 1. 블루팀 (왼쪽)
        html += `<div class="bar-group">`;
        blueTeam.forEach(p => {
            const val = p[metric.key] || 0;
            const width = maxVal > 0 ? (val / maxVal) * 100 : 0;
            const isTop = val === maxVal && val > 0;

            html += `
                <div class="comparison-row blue-row">
                    <span class="bar-val" style="text-align:right">${val.toLocaleString()}</span>
                    <div class="bar-wrapper">
                        <div class="bar blue-bar" style="width:${width}%"></div>
                    </div>
                    <img src="${getChampionSquareUrlByChampionId(p.championId)}" class="champ-mini">
                </div>`;
        });
        html += `</div>`;

        // ✅ 2. 중앙 요약 원형 (도넛 비율 계산 추가)
        const total = blueTotal + redTotal;
        const bluePercent = total > 0 ? (blueTotal / total) * 100 : 50;

        // from 0deg를 추가하여 12시 방향부터 색상이 나뉘도록 설정
        const redPercent = 100 - bluePercent;
        const donutGradient = `conic-gradient(from 0deg, #e84057 0% ${redPercent}%, #4287f5 ${redPercent}% 100%)`;

        html += `
            <div class="center-circle" style="--donut-gradient: ${donutGradient}">
                <div class="team-val" style="color:#60a5fa">${blueTotal.toLocaleString()}</div>
                <div style="height:1px; width:15px; background:rgba(255,255,255,0.3); margin:2px 0;"></div>
                <div class="team-val" style="color:#f87171">${redTotal.toLocaleString()}</div>
            </div>`;

        // 3. 레드팀 (오른쪽)
        html += `<div class="bar-group">`;
        redTeam.forEach(p => {
            const val = p[metric.key] || 0;
            const width = maxVal > 0 ? (val / maxVal) * 100 : 0;
            const isTop = val === maxVal && val > 0;
            html += `
                <div class="comparison-row red-row">
                    <img src="${getChampionSquareUrlByChampionId(p.championId)}" class="champ-mini">
                    <div class="bar-wrapper">
                        <div class="bar red-bar" style="width:${width}%"></div>
                    </div>
                    <span class="bar-val">${val.toLocaleString()}</span>
                </div>`;
        });
        html += `</div></div>`; // comparison-container 닫기

        itemDiv.innerHTML = html;
        grid.appendChild(itemDiv);
    });
    targetContainer.appendChild(grid);
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
            labels: [labelText],
            datasets: [
                {
                    // ✅ 0) 최근 10경기 평균 (항상 보임)
                    label: "10경기 평균",
                    data: [0],
                    barThickness: 50,
                    backgroundColor: "rgb(255, 255, 255)",
                },
                {
                    // ✅ 1) 선택한 경기 (항상 보임)
                    label: "선택한 경기",
                    data: [0],
                    barThickness: 50,
                    backgroundColor: "rgba(80,140,255,0.85)",
                },
                {
                    // ✅ 2) 티어 평균 (버튼 클릭 전에는 숨김 + 범례도 숨김)
                    label: "",
                    data: [0],
                    barThickness: 50,
                    backgroundColor: "rgba(255,255,255,0.0)",
                    hidden: true,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        // ✅ label이 빈 dataset은 범례에서 숨김
                        filter: (item) => item.text && item.text.trim().length > 0,
                    },
                },
            },
            scales: {
                y: { beginAtZero: true },
            },
        },
    });
}



/* 티어별 데이터 차트 생성 함수 */
function getBaselineValues() {
    if (!selectedBaselineName) return null;
    return TIER_BASELINES[selectedBaselineName] ?? null;
}

function applyBaselineToChart(chart, baselineLabel, baselineValue) {
    if (!chart) return;

    const ds = chart.data.datasets[1]; // ✅ baseline dataset

    if (!baselineLabel) {
        ds.hidden = true;
        ds.label = "";
        ds.data = [0];
        // ds.backgroundColor는 굳이 안 건드려도 됨
    } else {
        ds.hidden = false;
        ds.label = baselineLabel;
        ds.data = [Number(baselineValue ?? 0)];

        // ✅ 여기서 티어에 따라 색 넣기 (가장 중요)
        ds.backgroundColor = getBaselineColor(selectedBaselineName);
    }
}

function renderTeamStatsGraphs(matchJson) {
    const container = document.getElementById("teamAnalysisContainer");
    if (!container) return;
    container.innerHTML = ""; // 초기화
    container.style.display = "grid";

    const participants = matchJson.info.participants;

    // 6가지 핵심 지표 설정
    const metrics = [
        { key: 'kills', label: '챔피언 처치' },
        { key: 'goldEarned', label: '골드 획득량' },
        { key: 'totalDamageDealtToChampions', label: '챔피언에게 가한 피해량' },
        { key: 'wardsPlaced', label: '와드 설치' },
        { key: 'totalDamageTaken', label: '받은 피해량' },
        { key: 'totalMinionsKilled', label: 'CS' }
    ];

    metrics.forEach(metric => {
        const itemDiv = document.createElement("div");
        itemDiv.className = "analysis-item";

        // 팀별 데이터 분리 (블루: 100, 레드: 200)
        const blueTeam = participants.filter(p => p.teamId === 100);
        const redTeam = participants.filter(p => p.teamId === 200);

        const blueTotal = blueTeam.reduce((sum, p) => sum + (p[metric.key] || 0), 0);
        const redTotal = redTeam.reduce((sum, p) => sum + (p[metric.key] || 0), 0);
        const maxVal = Math.max(...participants.map(p => p[metric.key] || 0));

        let html = `<div class="analysis-title">${metric.label}</div>`;
        html += `<div style="display:flex; align-items:center; gap:10px; justify-content:center;">`;

        // 왼쪽 (블루팀) 리스트
        html += `<div class="bar-group">`;
        blueTeam.forEach(p => {
            const width = ((p[metric.key] || 0) / maxVal) * 100;
            html += `
                <div class="comparison-row" style="justify-content: flex-end;">
                    <span class="bar-val" style="text-align:right">${(p[metric.key] || 0).toLocaleString()}</span>
                    <div class="bar-wrapper" style="width:60px; justify-content: flex-end;">
                        <div class="bar blue-bar" style="width:${width}%"></div>
                    </div>
                    <img src="${getChampionSquareUrlByChampionId(p.championId)}" class="champ-mini">
                </div>`;
        });
        html += `</div>`;

        // 중앙 요약 원형 (스크린샷 스타일)
        const borderColor = blueTotal > redTotal ? "#4287f5" : "#e84057";
        html += `
            <div class="center-circle" style="border-color:${borderColor}">
                <div style="text-align:center">
                    <div style="color:#4287f5">${blueTotal.toLocaleString()}</div>
                    <div style="color:#e84057">${redTotal.toLocaleString()}</div>
                </div>
            </div>`;

        // 오른쪽 (레드팀) 리스트
        html += `<div class="bar-group">`;
        redTeam.forEach(p => {
            const width = ((p[metric.key] || 0) / maxVal) * 100;
            html += `
                <div class="comparison-row">
                    <img src="${getChampionSquareUrlByChampionId(p.championId)}" class="champ-mini">
                    <div class="bar-wrapper" style="width:60px;">
                        <div class="bar red-bar" style="width:${width}%"></div>
                    </div>
                    <span class="bar-val">${(p[metric.key] || 0).toLocaleString()}</span>
                </div>`;
        });
        html += `</div></div>`;

        itemDiv.innerHTML = html;
        container.appendChild(itemDiv);
    });
}


function initMetricCharts() {
    charts.cs10 = createSingleBarChart("c_cs10", "CS @ 10");
    charts.takedowns = createSingleBarChart("c_takedowns", "10분 전 적 처치관여 횟수");
    charts.dpm = createSingleBarChart("c_dpm", "DPM / GPM");
    charts.vpm = createSingleBarChart("c_vpm", "VPM(분당 시야점수)");
    charts.pings = createSingleBarChart("c_pings", "핑찍은 횟수");
}

function setChartValues(chart, matchValue, baselineValue) {
    if (!chart) return;

    // 0번 = 선택 경기
    chart.data.datasets[0].data = [Number(matchValue ?? 0)];

    // 1번 = 기준(아이언 평균)
    const hasBaseline = baselineValue !== null && baselineValue !== undefined;
    chart.data.datasets[1].hidden = !hasBaseline;
    chart.data.datasets[1].data = [Number(baselineValue ?? 0)];
    chart.data.datasets[1].backgroundColor = [(baselineValue.color ?? 0)];

    chart.update();
}

// (선택) 티어 영문 → 한글 표시용
const TIER_NAME_KO = {
    IRON: "아이언",
    BRONZE: "브론즈",
    SILVER: "실버",
    GOLD: "골드",
    PLATINUM: "플래티넘", // 네 코드 키가 PLATIINUM 이라 그대로 맞춤
    EMERALD: "에메랄드",
    DIAMOND: "다이아몬드",
    MASTER: "마스터",
    GRANDMASTER: "그랜드마스터",
    CHALLENGER: "챌린저",
};

function getTierDisplayName() {
    if (!selectedBaselineName) return "-";
    return TIER_NAME_KO[selectedBaselineName] ?? selectedBaselineName;
}

function setPlaceholder(phName, text) {
    document.querySelectorAll(`[data-ph="${phName}"]`).forEach((el) => {
        el.textContent = text;
    });
}

function showEl(id, on) {
    const el = document.getElementById(id);
    
    if (!el) return;
    el.style.display = on ? "" : "none";
}

function toggleGoodBad(metricKey, isGood) {
    showEl(`${metricKey}_good`, isGood);
    showEl(`${metricKey}_bad`, !isGood);
}

// ✅ 코멘트의 ○○ 채우기 + (선택) 잘한점/아쉬운점 자동 토글
function updateMetricComments(stats) {
    if (!stats) return;

    const baseline = getBaselineValues(); // 선택 티어 평균 (없으면 null)  :contentReference[oaicite:6]{index=6}
    const tierText = getTierDisplayName();

    // 공통: 티어 이름
    setPlaceholder("tier_name", tierText);

    // 선택 경기 값들
    const isJungle = stats.position === "JUNGLE";
    const cs10 = isJungle ? stats.jungleCsBefore10Minutes : stats.laneMinionsFirst10Minutes;

    const gpm = Number(stats.goldPerMinute ?? 0);
    const dpm = Number(stats.damagePerMinute ?? 0);
    const dpmgpm = gpm > 0 ? dpm / gpm : 0;

    setPlaceholder("cs10_value", formatNumber(cs10, 1));
    setPlaceholder("takedowns_value", formatNumber(stats.takedownsFirstXMinutes, 1));
    setPlaceholder("dpm_value", dpmgpm.toFixed(2));
    setPlaceholder("vpm_value", formatNumber(stats.visionScorePerMinute, 2));
    setPlaceholder("pings_value", String(stats.totalPings ?? "-"));

    // (선택) baseline을 선택했을 때만 잘한점/아쉬운점 둘 중 하나만 보여주기
    if (!baseline) {
        // baseline 미선택이면 둘 다 보여주고 싶으면 아래 주석 해제
        // showEl("cs10_good", true); showEl("cs10_bad", true);
        return;
    }

    toggleGoodBad("cs10", Number(cs10 ?? 0) >= Number(baseline.cs10 ?? 0));
    toggleGoodBad("takedowns", Number(stats.takedownsFirstXMinutes ?? 0) >= Number(baseline.takedowns ?? 0));
    toggleGoodBad("dpm", Number(dpmgpm ?? 0) >= Number(baseline.DPMGPM ?? 0));
    toggleGoodBad("vpm", Number(stats.visionScorePerMinute ?? 0) >= Number(baseline.vpm ?? 0));
    toggleGoodBad("pings", Number(stats.totalPings ?? 0) >= Number(baseline.pings ?? 0));
}



function updateMetricCharts(matchJson, stats) {
    if (!stats) return;

    const isJungle = stats.position === "JUNGLE";

    // ===== 선택 경기 값 =====
    const cs10Selected = isJungle ? stats.jungleCsBefore10Minutes : stats.laneMinionsFirst10Minutes;

    const dpm = Number(stats.damagePerMinute ?? 0);
    const gpm = Number(stats.goldPerMinute ?? 0);
    const dpmgpmSelected = gpm > 0 ? dpm / gpm : 0;

    const takedownsSelected = Number(stats.takedownsFirstXMinutes ?? 0);
    const vpmSelected = Number(stats.visionScorePerMinute ?? 0);
    const pingsSelected = Number(stats.totalPings ?? 0);

    // ===== 10경기 평균 값(항상 유지) =====
    const cs10Avg = isJungle ? (recent10Avg?.cs10Jungle ?? 0) : (recent10Avg?.cs10Lane ?? 0);
    const takedownsAvg = recent10Avg?.takedowns ?? 0;
    const dpmgpmAvg = recent10Avg?.DPMGPM ?? 0;
    const vpmAvg = recent10Avg?.vpm ?? 0;
    const pingsAvg = recent10Avg?.pings ?? 0;

    // ===== 티어 평균 값(버튼 누르면만 표시) =====
    const tierBase = selectedBaselineName ? (TIER_BASELINES[selectedBaselineName] ?? null) : null;
    const tierLabel = tierBase ? `${selectedBaselineName} 평균` : "";
    const tierColor = tierBase ? getBaselineColor(selectedBaselineName) : "rgba(0,0,0,0)";

    // cs 라벨(정글/라인) 갱신
    if (charts.cs10) {
        charts.cs10.data.labels = [isJungle ? "10분 전 정글 몬스터" : "10분 전 라인 미니언"];
    }

    // ✅ 각 차트에 3개 막대를 채우는 헬퍼
    const setTriple = (chart, avgVal, selVal, tierVal) => {
        if (!chart) return;

        // 0) 10경기 평균
        chart.data.datasets[0].label = "10경기 평균";
        chart.data.datasets[0].data = [Number(avgVal ?? 0)];

        // 1) 선택 경기
        chart.data.datasets[1].label = "선택한 경기";
        chart.data.datasets[1].data = [Number(selVal ?? 0)];

        // 2) 티어 평균 (있으면 보이게 / 없으면 숨기기)
        if (tierBase) {
            chart.data.datasets[2].hidden = false;
            chart.data.datasets[2].label = tierLabel;
            chart.data.datasets[2].backgroundColor = tierColor;
            chart.data.datasets[2].data = [Number(tierVal ?? 0)];
        } else {
            chart.data.datasets[2].hidden = true;
            chart.data.datasets[2].label = "";
            chart.data.datasets[2].data = [0];
            chart.data.datasets[2].backgroundColor = "rgba(0,0,0,0)";
        }

        chart.update();
    };

    setTriple(charts.cs10, cs10Avg, cs10Selected, tierBase?.cs10);
    setTriple(charts.takedowns, takedownsAvg, takedownsSelected, tierBase?.takedowns);
    setTriple(charts.dpm, dpmgpmAvg, dpmgpmSelected, tierBase?.DPMGPM);
    setTriple(charts.vpm, vpmAvg, vpmSelected, tierBase?.vpm);
    setTriple(charts.pings, pingsAvg, pingsSelected, tierBase?.pings);

    // 제목 갱신
    const me = pickMe(matchJson, currentPuuid);
    const champ = me?.championName ?? "Unknown";
    const when = matchJson?.info?.gameEndTimestamp ? formatDate(matchJson.info.gameEndTimestamp) : "-";
    const result = me?.win ? "WIN" : "LOSE";

    const titleEl = document.getElementById("chartTitle");
    if (titleEl) {
        titleEl.textContent = tierBase
            ? `${result} · ${champ} · ${when} (10경기 평균 + 선택 경기 + ${selectedBaselineName} 평균)`
            : `${result} · ${champ} · ${when} (10경기 평균 + 선택 경기)`;
    }
    updateMetricComments(stats);
}



function setChartValue(chart, value) {
    if (!chart) return;
    // dataset[0] = 선택 경기
    chart.data.datasets[0].data = [Number(value ?? 0)];
}

// ===== 코멘트 UX =====
// - 티어(베이스라인) 미선택: "기본 설명"만 표시
// - 티어 선택: 기본 설명 + (잘한점/아쉬운점 등) "분석" 영역까지 표시

function splitTierCommentBox(commentBox) {
    if (!commentBox) return;
    if (commentBox.dataset.splitDone === "1") return;

    // 기존 노드 백업
    const nodes = Array.from(commentBox.childNodes);

    // 비어있으면 패스
    if (!nodes.length) {
        commentBox.dataset.splitDone = "1";
        return;
    }

    // Split 기준(처음 등장하는 "잘한점/아쉬운" 지점부터 분석 영역으로)
    const markerIdx = nodes.findIndex((n) => {
        const t = (n.textContent || "").replace(/\s+/g, "");
        return (
            t.includes("잘한점") ||
            t.includes("아쉬운점") ||
            t.includes("아쉬운") ||
            t.includes("개선할점")
        );
    });

    const splitAt = markerIdx === -1 ? nodes.length : markerIdx;

    const basic = document.createElement("div");
    basic.className = "commentBasic";

    const analysis = document.createElement("div");
    analysis.className = "commentAnalysis";

    // commentBox 비우고 다시 담기
    while (commentBox.firstChild) commentBox.removeChild(commentBox.firstChild);

    nodes.forEach((n, idx) => {
        (idx < splitAt ? basic : analysis).appendChild(n);
    });

    commentBox.appendChild(basic);

    // 분석 파트가 비어있지 않으면 붙임
    if (analysis.childNodes.length) {
        commentBox.appendChild(analysis);
        analysis.style.display = "none"; // 기본은 숨김 (티어 선택 시만 표시)
    }

    commentBox.dataset.splitDone = "1";
}

// ✅ 티어 선택 여부에 따라 "분석 영역"만 토글
function setTierCommentVisible(hasBaseline) {
    document.querySelectorAll(".tierComment").forEach((box) => {
        // 코멘트 박스 자체는 항상 보이게(기본 설명은 유지)
        box.style.display = "block";

        // split이 안 되어있으면 먼저 분리
        splitTierCommentBox(box);

        const basic = box.querySelector(".commentBasic");
        const analysis = box.querySelector(".commentAnalysis");

        if (basic) basic.style.display = "block";
        if (analysis) analysis.style.display = hasBaseline ? "block" : "none";
    });
}

// ✅ 기존 HTML 구조(차트 사이에 섞여있는 설명 텍스트)를 각 chartItem 내부로 이동
function normalizeChartComments() {
    const grid = document.querySelector("#chartSection .chartsGrid");
    if (!grid) return;

    // 이미 정리된 경우라도 split은 보장
    const existing = grid.querySelectorAll(".chartItem .tierComment");
    if (existing.length) {
        existing.forEach(splitTierCommentBox);
        return;
    }

    const children = Array.from(grid.childNodes);

    for (let i = 0; i < children.length; i++) {
        const node = children[i];
        if (!(node instanceof HTMLElement)) continue;
        if (!node.classList.contains("chartItem")) continue;

        const chartItem = node;

        // chartItem 다음에 나오는 "텍스트/BR 등"을 이 chartItem의 코멘트로 모음
        let j = i + 1;

        const commentBox = document.createElement("div");
        commentBox.className = "tierComment";
        commentBox.style.display = "block"; // ✅ 박스는 항상 보이게 (기본설명 유지)

        // 다음 chartItem이 나오기 전까지의 노드를 commentBox에 넣기
        while (j < children.length) {
            const next = children[j];
            if (next instanceof HTMLElement && next.classList.contains("chartItem")) break;

            // 텍스트/BR/기타 노드 모두 이동
            commentBox.appendChild(next);
            j++;
        }

        chartItem.appendChild(commentBox);
        splitTierCommentBox(commentBox);

        // i를 다음 chartItem 직전으로 점프
        i = j - 1;
    }
}


document.querySelectorAll('.tier-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tier = btn.dataset.tier; // 예: EMERALD
        const tierText = btn.textContent.trim(); // 예: 에메랄드

        // 1. 모든 [data-ph="tier_name"] 요소를 찾습니다.
        const tierNameSpans = document.querySelectorAll('[data-ph="tier_name"]');

        tierNameSpans.forEach(span => {
            // 기존 티어 색상 클래스 모두 제거
            span.className = '';

            // 새 티어 색상 클래스 적용 (예: tier-color-EMERALD)
            span.classList.add(`tier-color-${tier}`);

            // 글자 변경
            span.textContent = tierText;
        });
    });
});





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


        // ✅ 추가: 최근 10경기 평균 계산
        recent10Avg = computeRecent10Averages(details, currentPuuid);

        // 아이콘 로딩 실패해도 매치 출력은 되게
        try { await loadDataDragonChampionMap(); } catch { }

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
            const matchJson = matchMap.get(matchId);

            if (!matchJson || !extra) return;

            const isAlreadyOpen = extra.style.display === "block";

            // 1) 모든 카드 닫기
            container.querySelectorAll(".extra").forEach((el) => (el.style.display = "none"));

            if (!isAlreadyOpen) {
                // ✅ [중요] 티어 버튼 기능을 위해 현재 선택된 데이터를 전역 변수에 저장
                lastSelectedMatchJson = matchJson;
                lastSelectedStats = extractSelectedStats(matchJson, currentPuuid);

                // 2) 매치 카드 내부에 텍스트 + 팀 분석 그래프 출력
                renderExtraStats(extra, matchJson);
                extra.style.display = "block";

                // 3) 하단 개인 지표 차트(Chart.js) 섹션 보여주기 및 업데이트
                const chartSection = document.getElementById("chartSection");
                if (chartSection) {
                    chartSection.style.display = "block";

                    if (!chartsInitialized) {
                        initMetricCharts();
                        chartsInitialized = true;
                    }
                    // 저장된 stats를 바탕으로 차트 업데이트
                    updateMetricCharts(lastSelectedMatchJson, lastSelectedStats);
                }

                // 4) 스크롤 이동
                chartSection?.scrollIntoView({ behavior: "smooth", block: "start" });
            } else {
                // 이미 열린걸 다시 누르면 하단 섹션도 숨김
                const chartSection = document.getElementById("chartSection");
                if (chartSection) chartSection.style.display = "none";

                // 데이터 초기화
                lastSelectedMatchJson = null;
                lastSelectedStats = null;
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

function toggleBaseline(tierName) {
    const currentCheckbox = document.getElementById(tierName.toLowerCase());

    // 1. 하나만 선택되도록 다른 체크박스 해제
    if (currentCheckbox && currentCheckbox.checked) {
        document.querySelectorAll('.tier-ckb').forEach(ckb => {
            if (ckb !== currentCheckbox) ckb.checked = false;
        });
    }

    // 2. 경기 선택 여부 확인
    if (!lastSelectedMatchJson || !lastSelectedStats) {
        alert("먼저 전적(경기)을 하나 클릭해서 차트를 생성해 주세요.");
        if (currentCheckbox) currentCheckbox.checked = false;
        return;
    }

    // 3. 변수 업데이트 (토글)
    if (selectedBaselineName === tierName) {
        selectedBaselineName = null;
    } else {
        selectedBaselineName = tierName;
    }

    // 4. 원래 있던 마무리 로직 (중요!)
    setTierCommentVisible(!!selectedBaselineName);

    if (!chartsInitialized) {
        initMetricCharts();
        chartsInitialized = true;
    }
    updateMetricCharts(lastSelectedMatchJson, lastSelectedStats);
}


document.getElementById("iron")?.addEventListener("click", () => toggleBaseline("IRON"));
document.getElementById("bronze")?.addEventListener("click", () => toggleBaseline("BRONZE"));
document.getElementById("silver")?.addEventListener("click", () => toggleBaseline("SILVER"));
document.getElementById("gold")?.addEventListener("click", () => toggleBaseline("GOLD"));
document.getElementById("platinum")?.addEventListener("click", () => toggleBaseline("PLATINUM"));
document.getElementById("emerald")?.addEventListener("click", () => toggleBaseline("EMERALD"));
document.getElementById("diamond")?.addEventListener("click", () => toggleBaseline("DIAMOND"));
document.getElementById("master")?.addEventListener("click", () => toggleBaseline("MASTER"));
document.getElementById("grandmaster")?.addEventListener("click", () => toggleBaseline("GRANDMASTER"));
document.getElementById("challenger")?.addEventListener("click", () => toggleBaseline("CHALLENGER"));



$("back")?.addEventListener("click", () => {
    sessionStorage.removeItem(STORAGE_KEY);
    window.location.assign("./index.html");
});

setTierCommentVisible(false);
normalizeChartComments();


init();
