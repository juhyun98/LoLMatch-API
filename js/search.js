// ✅ 여기에 Riot API Key 넣기 (개발용 / 배포 금지)
const RIOT_API_KEY = "";

// ✅ ASIA 고정
const REGION = "asia";
const STORAGE_KEY = "riotSearchPayload";

const $ = (id) => document.getElementById(id);
const out = $("out");

function parseRiotId(input) {
  const raw = (input ?? "").trim();

  // 'GameName#KR1' 형태에서 마지막 # 기준으로 분리 (닉네임에 #가 들어가는 경우 방어)
  const idx = raw.lastIndexOf("#");
  if (idx <= 0 || idx === raw.length - 1) return null;

  const gameName = raw.slice(0, idx).trim();
  const tagLine = raw.slice(idx + 1).trim();

  if (!gameName || !tagLine) return null;
  return { gameName, tagLine };
}

function baseUrl() {
  return `https://${REGION}.api.riotgames.com`;
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

/* 라이엇 계정 조회하는 기능 (입력받은 닉네임과 태그이름을 통해 조회) */
async function getAccountByRiotId(gameName, tagLine) {
  const url =
    `${baseUrl()}/riot/account/v1/accounts/by-riot-id/` +
    `${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  return riotFetchJson(url);
}

/* 라이엇 전적 매치 데이터를 가져오는 기능 (puuid를 통해 최근 10경기를 가져옴) */
/* 먼저 라이엇 계정 조회가 일어나야 puuid값을 알 수 있다. (계정 조회가 선행되어야함) */
async function getMatchIdsByPuuid(puuid, start = 0, count = 10) {
  const url =
    `${baseUrl()}/lol/match/v5/matches/by-puuid/` +
    `${encodeURIComponent(puuid)}/ids?start=${start}&count=${count}`;
  return riotFetchJson(url);
}


const RANKED_SOLO_QUEUE = 420; // 솔랭만

async function getMatchIdsByPuuid(puuid, start = 0, count = 10, queue = RANKED_SOLO_QUEUE) {
  const qs = new URLSearchParams({ start: String(start), count: String(count) });
  if (queue != null) qs.set("queue", String(queue)); // ✅ queue=420

  const url = `${baseUrl()}/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?${qs}`;
  return riotFetchJson(url);
}


$("form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const riotIdInput = $("riotId").value;
  const parsed = parseRiotId(riotIdInput);

  if (!parsed) {
    console.log("Riot ID를 gameName#tagLine 형식으로 입력해 주세요. 예) Hide on bush#KR1");
    alert("Riot ID를 gameName#tag 형식으로 입력해 주세요. \n예) Hide on bush#KR1");
    return;
  }

  const { gameName, tagLine } = parsed;

  try {
    console.log("조회 중...");

    const account = await getAccountByRiotId(gameName, tagLine);
    const puuid = account.puuid;

    const matchIds = await getMatchIdsByPuuid(puuid, 0, 10); // 최근 10개 고정

    const payload = {
      riotId: `${account.gameName}#${account.tagLine}`,
      puuid,
      matchIds,
      createdAt: new Date().toISOString(),
    };

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    window.location.assign("./main.html");
  } catch (err) {
    console.log({ error: "검색 실패", ...err });
    alert("Riot ID를 gameName#tag 형식으로 입력해 주세요. \n예) Hide on bush#KR1");
  }
});

