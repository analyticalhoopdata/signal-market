#!/usr/bin/env node
// ============================================================================
// buySignal.js — Execute a signal purchase as the buyer
// ============================================================================
// Full purchase flow: check balance → approve YODA → buy signal on contract.
//
// Usage:
//   node scripts/buySignal.js <signalId>
//   node scripts/buySignal.js 3
// ============================================================================

require("dotenv").config();
const { ethers } = require("ethers");

// =========================================================================
// Constants
// =========================================================================
const YODA_TOKEN_ADDRESS = "0xbd27d0b7F9fedb5A2A2C3ceF5dC9c70f3CF64Af2";
const SIGNAL_MARKET_ADDRESS = "0x5D6Ec77a95Cc0A7EA6047faE8140F9128E397f73";
const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

const SIGNAL_MARKET_ABI = [
  "function buySignal(uint signalId) external",
  "function getSignal(uint id) view returns (tuple(uint id, string sport, string market, string description, string previewHint, uint priceInYoda, bool sold, address currentOwner))",
  "function getMySignals() view returns (uint[])",
  "event SignalPurchased(uint indexed signalId, address indexed buyer, uint price)"
];

// =========================================================================
// Main
// =========================================================================
async function main() {
  // --- Parse signal ID from args ---
  const signalId = parseInt(process.argv[2]);
  if (isNaN(signalId)) {
    console.error("Usage: node scripts/buySignal.js <signalId>");
    console.error("Example: node scripts/buySignal.js 3");
    process.exit(1);
  }

  console.log("============================================================");
  console.log("  SIGNAL//MARKET — Buy Signal Script");
  console.log("  Signal ID:  " + signalId);
  console.log("  Contract:   " + SIGNAL_MARKET_ADDRESS);
  console.log("  Network:    Sepolia (" + SEPOLIA_RPC + ")");
  console.log("============================================================\n");

  // --- Validate env vars ---
  const buyerKey = process.env.BUYER_PRIVATE_KEY;
  if (!buyerKey) {
    console.error("ERROR: Set BUYER_PRIVATE_KEY in .env");
    process.exit(1);
  }

  // --- Connect ---
  const provider = new ethers.providers.JsonRpcProvider(SEPOLIA_RPC);
  const buyerWallet = new ethers.Wallet(buyerKey, provider);
  const yoda = new ethers.Contract(YODA_TOKEN_ADDRESS, ERC20_ABI, buyerWallet);
  const market = new ethers.Contract(SIGNAL_MARKET_ADDRESS, SIGNAL_MARKET_ABI, buyerWallet);

  const decimals = await yoda.decimals();
  const symbol = await yoda.symbol();

  console.log("Buyer wallet:", buyerWallet.address);

  // --- Step 1: Check buyer ETH for gas ---
  const ethBalance = await provider.getBalance(buyerWallet.address);
  console.log("ETH balance: ", ethers.utils.formatEther(ethBalance), "ETH");

  if (ethBalance.lt(ethers.utils.parseEther("0.002"))) {
    console.error("ERROR: Buyer needs more Sepolia ETH for gas.");
    process.exit(1);
  }

  // --- Step 2: Fetch signal details ---
  console.log("\nFetching signal #" + signalId + "...");
  let signal;
  try {
    signal = await market.getSignal(signalId);
  } catch (err) {
    console.error("ERROR: Could not fetch signal #" + signalId + ". Does it exist?");
    process.exit(1);
  }

  console.log("  Sport:   " + signal.sport);
  console.log("  Market:  " + signal.market);
  console.log("  Hint:    " + signal.previewHint);
  console.log("  Price:   " + signal.priceInYoda.toString() + " " + symbol);
  console.log("  Sold:    " + signal.sold);
  console.log("  Owner:   " + signal.currentOwner);

  if (signal.sold) {
    console.error("\nERROR: Signal #" + signalId + " is already sold.");
    process.exit(1);
  }

  // --- Step 3: Check YODA balance ---
  const priceWei = signal.priceInYoda.mul(ethers.BigNumber.from(10).pow(decimals));
  const yodaBalance = await yoda.balanceOf(buyerWallet.address);
  console.log("\nBuyer " + symbol + " balance: " + ethers.utils.formatUnits(yodaBalance, decimals));
  console.log("Signal price:          " + ethers.utils.formatUnits(priceWei, decimals) + " " + symbol);

  if (yodaBalance.lt(priceWei)) {
    console.error("ERROR: Insufficient " + symbol + " balance.");
    console.error("  Need: " + signal.priceInYoda.toString() + " " + symbol);
    console.error("  Have: " + ethers.utils.formatUnits(yodaBalance, decimals) + " " + symbol);
    process.exit(1);
  }

  // --- Step 4: Check and set allowance ---
  const currentAllowance = await yoda.allowance(buyerWallet.address, SIGNAL_MARKET_ADDRESS);
  console.log("Current allowance:     " + ethers.utils.formatUnits(currentAllowance, decimals) + " " + symbol);

  let approveTxHash = null;
  if (currentAllowance.lt(priceWei)) {
    console.log("\nAPPROVING " + signal.priceInYoda.toString() + " " + symbol + " for SignalMarket...");
    const approveTx = await yoda.approve(SIGNAL_MARKET_ADDRESS, priceWei);
    console.log("  TX submitted: " + approveTx.hash);
    approveTxHash = approveTx.hash;

    const approveReceipt = await approveTx.wait();
    console.log("  ✓ Approved in block " + approveReceipt.blockNumber);
  } else {
    console.log("\n  ✓ Sufficient allowance already set");
  }

  // --- Step 5: Buy the signal ---
  console.log("\nBROADCASTING PURCHASE for signal #" + signalId + "...");
  const buyTx = await market.buySignal(signalId);
  console.log("  TX submitted: " + buyTx.hash);

  const buyReceipt = await buyTx.wait();
  console.log("  ✓ Purchased in block " + buyReceipt.blockNumber);

  // --- Step 6: Verify ownership ---
  const ownedSignals = await market.getMySignals();
  const ownedList = ownedSignals.map(id => id.toString());
  console.log("\nOwned signals: [" + ownedList.join(", ") + "]");

  // --- Step 7: Read the unlocked signal ---
  const purchased = await market.getSignal(signalId);
  console.log("\n--- UNLOCKED SIGNAL DATA ---");
  console.log(purchased.description);
  console.log("----------------------------");

  // --- Summary ---
  const remainingYoda = await yoda.balanceOf(buyerWallet.address);

  console.log("\n===========================================================");
  console.log("  === PURCHASE COMPLETE ===");
  console.log("  Signal ID:      " + signalId);
  console.log("  Price paid:     " + signal.priceInYoda.toString() + " " + symbol);
  if (approveTxHash) {
    console.log("  Approve TX:     " + approveTxHash);
    console.log("  Etherscan:      https://sepolia.etherscan.io/tx/" + approveTxHash);
  }
  console.log("  Purchase TX:    " + buyTx.hash);
  console.log("  Etherscan:      https://sepolia.etherscan.io/tx/" + buyTx.hash);
  console.log("  Remaining YODA: " + ethers.utils.formatUnits(remainingYoda, decimals));
  console.log("  Owned signals:  [" + ownedList.join(", ") + "]");
  console.log("===========================================================");
}

main().catch(err => {
  console.error("\nFATAL:", err.message || err);
  process.exit(1);
});
