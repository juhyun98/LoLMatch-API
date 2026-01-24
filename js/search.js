// ✅ 여기에 Riot API Key 넣기 (개발용 / 배포 금지)
const RIOT_API_KEY = "RGAPI-fc260a63-30ef-486f-ae58-bf4b2ae25674";

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
  try { 
    data = text ? JSON.parse(text) : null; 
    } 
  catch { 
    data = { raw: text }; 
    }

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

// ✅ 1. 파티클 엔진 정의 (기존 코드 위에 추가)
function Particle(o) {
    this.C = document.createElement('canvas');
    this.C.id = 'particle-canvas'; // ID 부여
    document.body.appendChild(this.C);

    o = o !== undefined ? o : {};
    this.o = {
        w: (o.w !== undefined) ? o.w : window.innerWidth,
        h: (o.h !== undefined) ? o.h : window.innerHeight,
        c: (o.c !== undefined) ? o.c : '#fff',
        b: (o.b !== undefined) ? o.b : '#000',
        i: (o.i !== undefined) ? o.i : true,
        s: (o.s !== undefined) ? o.s : 0.5,
        d: (o.d !== undefined) ? o.d : 10000
    };
    this.C.size = { w: this.o.w, h: this.o.h };
    this._i();
}

Particle.prototype._i = function () {
    this.$ = this.C.getContext('2d');
    this.C.width = this.C.size.w;
    this.C.height = this.C.size.h;
    this.p = [];
    for (var i = 0; i < this.C.width * this.C.height / this.o.d; i++) {
        this.p.push(new P(this));
    }
    if (this.o.i) {
        this.m = new P(this);
        this.m.s = { x: 0, y: 0 };
        this.p.push(this.m);
        window.addEventListener('mousemove', function (e) {
            this.m.x = e.clientX;
            this.m.y = e.clientY;
        }.bind(this));
    }
    requestAnimationFrame(this._u.bind(this));
};

Particle.prototype._u = function () {
    this.$.clearRect(0, 0, this.C.width, this.C.height);
    for (var i = 0; i < this.p.length; i++) {
        this.p[i]._u();
        this.p[i]._d();
        for (var j = this.p.length - 1; j > i; j--) {
            var distance = Math.sqrt(Math.pow(this.p[i].x - this.p[j].x, 2) + Math.pow(this.p[i].y - this.p[j].y, 2));
            if (distance > 120) continue;
            this.$.beginPath();
            this.$.strokeStyle = this.o.c;
            this.$.globalAlpha = (120 - distance) / 120;
            this.$.lineWidth = 0.7;
            this.$.moveTo(this.p[i].x, this.p[i].y);
            this.$.lineTo(this.p[j].x, this.p[j].y);
            this.$.stroke();
        }
    }
    requestAnimationFrame(this._u.bind(this));
};

function P(_) {
    this.C = _; this.$ = _.$; this.c = _.o.c;
    this.x = Math.random() * _.o.w;
    this.y = Math.random() * _.o.h;
    this.s = { x: (Math.random() - 0.5) * _.o.s, y: (Math.random() - 0.5) * _.o.s };
}
P.prototype._u = function () {
    if (this.x > this.C.width + 20 || this.x < -20) this.s.x = -this.s.x;
    if (this.y > this.C.height + 20 || this.y < -20) this.s.y = -this.s.y;
    this.x += this.s.x; this.y += this.s.y;
};
P.prototype._d = function () {
    this.$.beginPath();
    this.$.fillStyle = this.c;
    this.$.globalAlpha = 0.7;
    this.$.arc(this.x, this.y, 1.5, 0, 2 * Math.PI);
    this.$.fill();
};

// ---------------------------------------------------------
// ✅ 3. 배경 실행 (코드 맨 마지막에 추가)
// ---------------------------------------------------------
new Particle({
    w: document.documentElement.clientWidth, // 스크롤바를 제외한 실제 너비
    h: window.innerHeight,
    c: '#00F2FF', // 시안 블루
    b: '#10131C', // 딥 네이비
    i: true,
    s: 0.7,
    d: 5000
});





