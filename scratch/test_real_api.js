require("dotenv").config();
const handler = require("../server.js");

async function checkUser(userId, label) {
  console.log(`\n--- Checking user ${label} (ID: ${userId}) ---`);
  const players = await handler.getPlayersByUserId(userId);
  console.log(JSON.stringify(players, null, 2));
}

async function run() {
  await checkUser("746e9655-45f0-4fbe-a669-2e97df372fc5", "Survive Zombie Arena User");
  await checkUser("214cccac-5fb1-4e4f-9b82-d9f9e7251c1c", "Toilet Tower Defense User");
}

run().catch(console.error);
