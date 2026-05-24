const https = require("https");

function fetchPlaceNameFromRoblox(placeId) {
  return new Promise((resolve) => {
    const url = `https://economy.roblox.com/v2/assets/${placeId}/details`;
    https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    }, (res) => {
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(raw);
          resolve(parsed);
        } catch (e) {
          resolve(e);
        }
      });
    }).on("error", (e) => {
      resolve(e);
    });
  });
}

async function run() {
  const result = await fetchPlaceNameFromRoblox("114204398207377");
  console.log("Roblox API Result:", result);
}

run().catch(console.error);
