#!/usr/bin/env node
// ============================================================================
// deployLocal.js — Deploy MockYoda + SignalMarket to local Hardhat node
// ============================================================================
// Run hardhat node first:  npx hardhat node
// Then:                    npx hardhat run scripts/deployLocal.js --network localhost
// ============================================================================

const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [owner] = await ethers.getSigners();
  console.log("Deploying from:", owner.address, "\n");

  // --- Deploy MockYoda ---
  const MockYoda = await ethers.getContractFactory("MockYoda");
  const yoda = await MockYoda.deploy();
  await yoda.deployed();
  console.log("MockYoda deployed at:", yoda.address);

  // --- Deploy SignalMarket ---
  const SignalMarket = await ethers.getContractFactory("SignalMarket");
  const market = await SignalMarket.deploy(yoda.address);
  await market.deployed();
  console.log("SignalMarket deployed at:", market.address);

  // --- Mint 10000 YODA to accounts 1-3 (buyers) ---
  const signers = await ethers.getSigners();
  const mintAmount = ethers.utils.parseUnits("10000", 18);
  for (let i = 1; i <= 3; i++) {
    await (await yoda.mint(signers[i].address, mintAmount)).wait();
    console.log("Minted 10000 YODA to account #" + i + ":", signers[i].address);
  }

  // --- List 3 test signals ---
  const signals = [
    {
      sport: "NBA",
      market: "Player Props - Points",
      description:
        "under 22.5 Jayson Tatum Points Boston Celtics at Miami Heat\n" +
        "Odds: 1.87 (-115)\nClosing Line: 1.80\n" +
        "Edge (CLV): +3.89%\nMatchup: Boston Celtics at Miami Heat\n" +
        "Source: ProphetX | Settled: WIN",
      previewHint: "under 22.5 Jayson Tatum Points Boston Celtics at Miami Heat | EV: +3.9%",
      price: 100,
    },
    {
      sport: "MLB",
      market: "Pitcher Props - Strikeouts",
      description:
        "over 6.5 Gerrit Cole Strikeouts New York Yankees at Houston Astros\n" +
        "Odds: 2.10 (+110)\nClosing Line: 1.95\n" +
        "Edge (CLV): +7.69%\nMatchup: New York Yankees at Houston Astros\n" +
        "Source: ProphetX | Settled: WIN",
      previewHint: "over 6.5 Gerrit Cole Strikeouts New York Yankees at Houston Astros | EV: +7.7%",
      price: 150,
    },
    {
      sport: "NBA",
      market: "Player Props - Assists",
      description:
        "over 8.5 Tyrese Haliburton Assists Indiana Pacers at Cleveland Cavaliers\n" +
        "Odds: 1.95 (-105)\nClosing Line: 1.85\n" +
        "Edge (CLV): +5.41%\nMatchup: Indiana Pacers at Cleveland Cavaliers\n" +
        "Source: ProphetX | Settled: WIN",
      previewHint: "over 8.5 Tyrese Haliburton Assists Indiana Pacers at Cleveland Cavaliers | EV: +5.4%",
      price: 120,
    },
  ];

  for (let i = 0; i < signals.length; i++) {
    const s = signals[i];
    await (await market.listSignal(s.sport, s.market, s.description, s.previewHint, s.price)).wait();
    console.log("Listed signal #" + (i + 1) + ": [" + s.sport + "] " + s.previewHint.slice(0, 60) + "...");
  }

  // --- Output summary ---
  console.log("\n============================================================");
  console.log("  LOCAL DEPLOYMENT COMPLETE");
  console.log("  MockYoda:      " + yoda.address);
  console.log("  SignalMarket:  " + market.address);
  console.log("  Owner:         " + owner.address);
  console.log("  Signals listed: 3");
  console.log("  Buyers funded:  accounts #1-#3 (10000 YODA each)");
  console.log("============================================================");
}

main().catch(err => {
  console.error("FATAL:", err.message || err);
  process.exit(1);
});
