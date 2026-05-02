#!/usr/bin/env node
// ============================================================================
// fundBuyer.js — Send YODA tokens from owner to buyer wallet
// ============================================================================
// Transfers YODA tokens so the buyer can purchase signals.
// Also checks buyer's Sepolia ETH balance for gas.
//
// Usage:
//   node scripts/fundBuyer.js
//   node scripts/fundBuyer.js --amount 3000   (custom amount, default 2000)
// ============================================================================

require("dotenv").config();
const { ethers } = require("ethers");

// =========================================================================
// Constants
// =========================================================================
const YODA_TOKEN_ADDRESS = "0xbd27d0b7F9fedb5A2A2C3ceF5dC9c70f3CF64Af2";
const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const MIN_ETH_FOR_GAS = "0.005";

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

// Parse --amount flag (default 2000 YODA)
const amountFlag = process.argv.find((a, i) => process.argv[i - 1] === "--amount");
const AMOUNT_YODA = parseInt(amountFlag) || 2000;

// =========================================================================
// Main
// =========================================================================
async function main() {
  console.log("============================================================");
  console.log("  SIGNAL//MARKET — Fund Buyer Script");
  console.log("  Yoda Token: " + YODA_TOKEN_ADDRESS);
  console.log("  Network:    Sepolia (" + SEPOLIA_RPC + ")");
  console.log("============================================================\n");

  // --- Validate env vars ---
  const ownerKey = process.env.PRIVATE_KEY;
  if (!ownerKey || ownerKey === "your_private_key_here") {
    console.error("ERROR: Set PRIVATE_KEY in .env");
    process.exit(1);
  }

  const buyerAddress = process.env.BUYER_ADDRESS;
  if (!buyerAddress) {
    console.error("ERROR: Set BUYER_ADDRESS in .env");
    process.exit(1);
  }

  // --- Connect ---
  const provider = new ethers.providers.JsonRpcProvider(SEPOLIA_RPC);
  const ownerWallet = new ethers.Wallet(ownerKey, provider);
  const yoda = new ethers.Contract(YODA_TOKEN_ADDRESS, ERC20_ABI, ownerWallet);

  const decimals = await yoda.decimals();
  const symbol = await yoda.symbol();

  console.log("Owner wallet:  ", ownerWallet.address);
  console.log("Buyer wallet:  ", buyerAddress);
  console.log("Token:         ", symbol, "(" + decimals + " decimals)");
  console.log("Amount to send:", AMOUNT_YODA, symbol, "\n");

  // --- Check owner YODA balance ---
  const ownerBalance = await yoda.balanceOf(ownerWallet.address);
  const ownerBalFormatted = ethers.utils.formatUnits(ownerBalance, decimals);
  console.log("Owner " + symbol + " balance:", ownerBalFormatted);

  const amountWei = ethers.utils.parseUnits(String(AMOUNT_YODA), decimals);
  if (ownerBalance.lt(amountWei)) {
    console.error("ERROR: Owner has insufficient " + symbol + " balance.");
    console.error("  Need: " + AMOUNT_YODA + " " + symbol);
    console.error("  Have: " + ownerBalFormatted + " " + symbol);
    process.exit(1);
  }

  // --- Check buyer ETH balance for gas ---
  const buyerEth = await provider.getBalance(buyerAddress);
  const buyerEthFormatted = ethers.utils.formatEther(buyerEth);
  console.log("Buyer ETH balance:", buyerEthFormatted, "ETH");

  if (buyerEth.lt(ethers.utils.parseEther(MIN_ETH_FOR_GAS))) {
    console.warn("WARNING: Buyer has < " + MIN_ETH_FOR_GAS + " ETH. They may not have enough gas for transactions.");
    console.warn("         Send Sepolia ETH to " + buyerAddress + " before buying signals.\n");
  } else {
    console.log("  ✓ Buyer has enough ETH for gas\n");
  }

  // --- Check buyer current YODA balance ---
  const buyerYodaBefore = await yoda.balanceOf(buyerAddress);
  console.log("Buyer " + symbol + " balance (before):", ethers.utils.formatUnits(buyerYodaBefore, decimals), "\n");

  // --- Transfer YODA ---
  console.log("Sending " + AMOUNT_YODA + " " + symbol + " to buyer...");

  const tx = await yoda.transfer(buyerAddress, amountWei);
  console.log("  TX submitted: " + tx.hash);

  const receipt = await tx.wait();
  console.log("  ✓ Confirmed in block " + receipt.blockNumber);
  console.log("  TX hash: " + receipt.transactionHash);

  // --- Verify ---
  const buyerYodaAfter = await yoda.balanceOf(buyerAddress);
  console.log("\nBuyer " + symbol + " balance (after):", ethers.utils.formatUnits(buyerYodaAfter, decimals));

  console.log("\n===========================================================");
  console.log("  === TRANSFER COMPLETE ===");
  console.log("  Sent: " + AMOUNT_YODA + " " + symbol);
  console.log("  To:   " + buyerAddress);
  console.log("  TX:   " + receipt.transactionHash);
  console.log("  Etherscan: https://sepolia.etherscan.io/tx/" + receipt.transactionHash);
  console.log("===========================================================");
}

main().catch(err => {
  console.error("\nFATAL:", err.message || err);
  process.exit(1);
});
