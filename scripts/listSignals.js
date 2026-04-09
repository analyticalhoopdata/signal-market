#!/usr/bin/env node
// ============================================================================
// listSignals.js — Bulk-list ProphetX winning signals onto SignalMarket
// ============================================================================
// Reads transactions.csv, filters for high-edge settled wins,
// and calls listSignal() on the deployed SignalMarket contract.
//
// Usage:
//   node scripts/listSignals.js
//   node scripts/listSignals.js --dry-run   (preview without sending txs)
// ============================================================================

require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

// =========================================================================
// Constants
// =========================================================================
const SIGNAL_MARKET_ADDRESS = "0xd149506D13656039084c01D5038146648e43Aa08";
const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

const ABI = [
  "function listSignal(string sport, string market, string description, string previewHint, uint priceInYoda) external",
  "function signalCount() view returns (uint)"
];

const DRY_RUN = process.argv.includes("--dry-run");
const TX_DELAY_MS = 2000; // 2s between txs to avoid nonce issues

// =========================================================================
// Helpers
// =========================================================================

/**
 * Convert decimal odds to American odds string.
 * e.g. 2.20 → "+120", 1.50 → "-200"
 */
function decimalToAmerican(decimal) {
  const d = parseFloat(decimal);
  if (isNaN(d) || d <= 1) return "N/A";
  if (d >= 2) {
    return "+" + Math.round((d - 1) * 100);
  } else {
    return Math.round(-100 / (d - 1)).toString();
  }
}

/**
 * Extract "Team A at Team B" matchup from bet_info string.
 *
 * ProphetX format:
 *   "under 18.5 Jalen Green Points Houston Rockets at Phoenix Suns"
 *   "under 4.5 Robbie Ray Hits Allowed Philadelphia Phillies at San Francisco Giants"
 *
 * Strategy: find " at ", walk backwards from it skipping stat keywords
 * to find where the home team name begins.
 */
function extractMatchup(betInfo) {
  const atIdx = betInfo.lastIndexOf(" at ");
  if (atIdx === -1) return "N/A";

  const away = betInfo.slice(atIdx + 4).trim();
  const before = betInfo.slice(0, atIdx).trim();
  const words = before.split(/\s+/);

  // Walk backwards collecting capitalized words that aren't stat keywords
  const statWords = new Set([
    "Points", "Assists", "Rebounds", "Total", "Hits", "Allowed",
    "Earned", "Runs", "Recorded", "Outs", "Bases", "Line", "Run",
    "Strikeouts", "Walks", "Steals", "Blocks", "Turnovers"
  ]);

  const teamWords = [];
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i];
    // Stop at stat keywords, "&", numbers, or lowercase words
    if (statWords.has(w) || w === "&" || /^\d/.test(w) || /^[a-z]/.test(w)) break;
    teamWords.unshift(w);
    if (teamWords.length >= 4) break; // Max 4 words for a team name
  }

  const home = teamWords.join(" ");
  return (home ? home + " at " : "") + away;
}

/**
 * Determine the market category from bet_info text.
 * Checks keywords in priority order.
 */
function classifyMarket(betInfo) {
  const b = betInfo;
  // Check multi-word terms first (more specific)
  if (b.includes("Total Bases"))    return "Player Props - Total Bases";
  if (b.includes("Earned Runs"))    return "Pitcher Props - Earned Runs";
  if (b.includes("Hits Allowed"))   return "Pitcher Props - Hits Allowed";
  if (b.includes("Outs Recorded"))  return "Pitcher Props - Outs";
  if (b.includes("Run Line"))       return "Run Line";
  if (b.includes("Total Runs"))     return "Game Totals";
  // Single-word stat terms
  if (b.includes("Points"))         return "Player Props - Points";
  if (b.includes("Assists"))        return "Player Props - Assists";
  if (b.includes("Rebounds"))       return "Player Props - Rebounds";
  if (b.includes("Strikeouts"))     return "Pitcher Props - Strikeouts";
  return "Props";
}

/**
 * Build the full signal parameters from a CSV row.
 */
function buildSignalParams(row) {
  const betInfo     = row.bet_info.trim();
  const odds        = row.odds;
  const closingLine = row.closing_line;
  const ev          = parseFloat(row.ev);
  const league      = row.leagues.trim();

  const sport       = league; // "NBA", "MLB", etc.
  const market      = classifyMarket(betInfo);
  const matchup     = extractMatchup(betInfo);

  // Preview hint: first 80 chars of bet_info + EV percentage
  const hintBase = betInfo.length > 80 ? betInfo.slice(0, 77) + "..." : betInfo;
  const previewHint = hintBase + " | EV: +" + (ev * 100).toFixed(1) + "%";

  // Full description (revealed after purchase)
  const description =
    betInfo +
    "\nOdds: " + odds + " (" + decimalToAmerican(odds) + ")" +
    "\nClosing Line: " + closingLine +
    "\nEdge (CLV): +" + (ev * 100).toFixed(2) + "%" +
    "\nMatchup: " + matchup +
    "\nSource: ProphetX | Settled: WIN";

  // Price scales with edge: min 50, ~1500x the ev decimal
  const priceInYoda = Math.max(50, Math.round(ev * 1500));

  return { sport, market, description, previewHint, priceInYoda };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =========================================================================
// Main
// =========================================================================
async function main() {
  console.log("============================================================");
  console.log("  SIGNAL//MARKET — Bulk Signal Listing Script");
  console.log("  Contract: " + SIGNAL_MARKET_ADDRESS);
  console.log("  Network:  Sepolia (" + SEPOLIA_RPC + ")");
  if (DRY_RUN) console.log("  MODE:     *** DRY RUN — no transactions will be sent ***");
  console.log("============================================================\n");

  // --- Validate private key ---
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey || privateKey === "your_private_key_here") {
    console.error("ERROR: Set PRIVATE_KEY in .env (see .env.example)");
    process.exit(1);
  }

  // --- Connect to Sepolia ---
  const provider = new ethers.providers.JsonRpcProvider(SEPOLIA_RPC);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(SIGNAL_MARKET_ADDRESS, ABI, wallet);

  const network = await provider.getNetwork();
  console.log("Connected as:", wallet.address);
  console.log("Network:     ", network.name, "(chainId " + network.chainId + ")");

  const balWei = await provider.getBalance(wallet.address);
  console.log("ETH Balance: ", ethers.utils.formatEther(balWei), "ETH\n");

  // --- Read & parse CSV ---
  const csvPath = path.join(__dirname, "..", "transactions.csv");
  if (!fs.existsSync(csvPath)) {
    console.error("ERROR: CSV not found at", csvPath);
    process.exit(1);
  }

  const csvRaw = fs.readFileSync(csvPath, "utf-8");
  const records = parse(csvRaw, {
    columns: true,       // use header row as keys
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true
  });

  console.log("CSV loaded:", records.length, "total rows\n");

  // --- Filter: SETTLED_WIN, ev > 0.02, bet_info non-empty ---
  const filtered = records.filter(r => {
    if (r.status !== "SETTLED_WIN") return false;
    const ev = parseFloat(r.ev);
    if (isNaN(ev) || ev <= 0.02) return false;
    if (!r.bet_info || !r.bet_info.trim()) return false;
    return true;
  });

  console.log("After filter (SETTLED_WIN, ev > 2%, bet_info present):", filtered.length, "rows");

  // --- Deduplicate by bet_info ---
  const seen = new Set();
  const unique = [];
  for (const row of filtered) {
    const key = row.bet_info.trim();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(row);
    }
  }

  console.log("After dedup by bet_info:", unique.length, "unique signals");

  // --- Sort by EV descending, take top 10 ---
  unique.sort((a, b) => parseFloat(b.ev) - parseFloat(a.ev));
  const selected = unique.slice(0, 10);

  console.log("Selected top 10 by edge:\n");

  // Preview table
  selected.forEach((row, i) => {
    const ev = parseFloat(row.ev);
    const params = buildSignalParams(row);
    console.log(
      `  ${String(i + 1).padStart(2)}. [${params.sport}] ${params.market}`
    );
    console.log(
      `      "${row.bet_info.trim().slice(0, 70)}${row.bet_info.trim().length > 70 ? '...' : ''}"`
    );
    console.log(
      `      EV: +${(ev * 100).toFixed(2)}% | Price: ${params.priceInYoda} YODA`
    );
    console.log();
  });

  if (DRY_RUN) {
    console.log("=== DRY RUN COMPLETE — no transactions sent ===");
    console.log("Remove --dry-run flag to list these signals on-chain.");
    process.exit(0);
  }

  // --- List signals on-chain ---
  let successCount = 0;
  let totalGas = ethers.BigNumber.from(0);

  const startCount = await contract.signalCount();
  console.log("Current signalCount on-chain:", startCount.toString());
  console.log("-----------------------------------------------------------\n");

  for (let i = 0; i < selected.length; i++) {
    const row = selected[i];
    const params = buildSignalParams(row);

    console.log(`Listing signal ${i + 1}/${selected.length}: ${params.previewHint.slice(0, 80)}`);

    try {
      const tx = await contract.listSignal(
        params.sport,
        params.market,
        params.description,
        params.previewHint,
        params.priceInYoda
      );

      console.log(`  TX submitted: ${tx.hash}`);

      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed;
      const effectiveGasPrice = receipt.effectiveGasPrice || ethers.BigNumber.from(0);
      const cost = gasUsed.mul(effectiveGasPrice);
      totalGas = totalGas.add(cost);

      const currentCount = await contract.signalCount();

      console.log(
        `  ✓ Confirmed | TX: ${receipt.transactionHash} | Block: ${receipt.blockNumber} | Signal ID: ${currentCount.toString()}`
      );

      successCount++;
    } catch (err) {
      console.error(`  ✗ FAILED: ${err.message || err}`);
      // Log but continue with remaining signals
    }

    // Wait between txs to avoid nonce collisions
    if (i < selected.length - 1) {
      console.log(`  Waiting ${TX_DELAY_MS / 1000}s...\n`);
      await sleep(TX_DELAY_MS);
    }
  }

  // --- Summary ---
  const endCount = await contract.signalCount();
  const gasEth = ethers.utils.formatEther(totalGas);

  console.log("\n===========================================================");
  console.log("  === COMPLETE ===");
  console.log(`  Signals listed: ${successCount}`);
  console.log(`  Total gas used: approximately ${gasEth} ETH`);
  console.log(`  Your SignalMarket now has ${endCount.toString()} signals available for purchase`);
  console.log("===========================================================");
}

main().catch(err => {
  console.error("\nFATAL:", err.message || err);
  process.exit(1);
});
