const https = require("https");

const placeId = "93712201161812";

function testEconomyApi(id) {
  return new Promise((resolve) => {
    const url = `https://economy.roblox.com/v2/assets/${id}/details`;
    console.log("Testing economy API:", url);
    https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    }, (res) => {
      console.log("Economy API status:", res.statusCode);
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(raw);
          console.log("Economy API parsed response:", parsed);
          resolve(parsed);
        } catch (e) {
          console.log("Economy API failed to parse response:", raw);
          resolve(null);
        }
      });
    }).on("error", (e) => {
      console.log("Economy API error:", e);
      resolve(null);
    });
  });
}

function testGamesApi(id) {
  return new Promise((resolve) => {
    const url = `https://games.roblox.com/v1/games/multiget-place-details?placeIds=${id}`;
    console.log("Testing games API:", url);
    https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    }, (res) => {
      console.log("Games API status:", res.statusCode);
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(raw);
          console.log("Games API parsed response:", parsed);
          resolve(parsed);
        } catch (e) {
          console.log("Games API failed to parse response:", raw);
          resolve(null);
        }
      });
    }).on("error", (e) => {
      console.log("Games API error:", e);
      resolve(null);
    });
  });
}

async function run() {
  await testEconomyApi(placeId);
  console.log("-------------------");
  await testGamesApi(placeId);
}

run();
