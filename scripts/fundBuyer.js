#!/usr/bin/env node
// ============================================================================
// fundBuyer.js — Send YODA tokens from owner → buyer wallet
// ============================================================================
// Reads PRIVATE_KEY (owner) and BUYER_ADDRESS (or BUYER_PRIVATE_KEY) from .env,
// and transfers FUND_AMOUNT_YODA whole tokens to the buyer.
// ============================================================================

require("dotenv").config();
const { ethers } = require("ethers");

const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const YODA_TOKEN_ADDRESS = "0xbd27d0b7F9fedb5A2A2C3ceF5dC9c70f3CF64Af2";
const SIGNAL_MARKET_ADDRESS = "0x5D6Ec77a95Cc0A7EA6047faE8140F9128E397f73";

// Sized for the post-Jakir 100 YODA owner balance: send 25 YODA to the buyer
// which covers 5 buys at the new flat 5 YODA/signal price.
const FUND_AMOUNT_YODA = 25;

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address,uint256) returns (bool)"
];

async function main() {
  console.log("============================================================");
  console.log("  fundBuyer — owner → buyer YODA transfer");
  console.log("============================================================");

  const pk = process.env.PRIVATE_KEY;
  if (!pk || pk === "your_private_key_here") {
    console.error("ERROR: PRIVATE_KEY (owner) not set in .env");
    process.exit(1);
  }

  let buyerAddr = process.env.BUYER_ADDRESS;
  if (!buyerAddr) {
    const buyerPk = process.env.BUYER_PRIVATE_KEY;
    if (!buyerPk) {
      console.error("ERROR: Set BUYER_ADDRESS or BUYER_PRIVATE_KEY in .env");
      process.exit(1);
    }
    buyerAddr = new ethers.Wallet(buyerPk).address;
  }
  if (!ethers.utils.isAddress(buyerAddr)) {
    console.error("ERROR: BUYER_ADDRESS is not a valid address: " + buyerAddr);
    process.exit(1);
  }

  const provider = new ethers.providers.JsonRpcProvider(SEPOLIA_RPC);
  const owner = new ethers.Wallet(pk, provider);
  const yoda = new ethers.Contract(YODA_TOKEN_ADDRESS, ERC20_ABI, owner);

  const decimals = await yoda.decimals();
  const symbol = await yoda.symbol();
  const ownerBal = await yoda.balanceOf(owner.address);
  const buyerBal = await yoda.balanceOf(buyerAddr);

  console.log("Owner:           " + owner.address);
  console.log("Buyer:           " + buyerAddr);
  console.log("YODA decimals:   " + decimals);
  console.log("Owner balance:   " + ethers.utils.formatUnits(ownerBal, decimals) + " " + symbol);
  console.log("Buyer balance:   " + ethers.utils.formatUnits(buyerBal, decimals) + " " + symbol);
  console.log("Sending:         " + FUND_AMOUNT_YODA + " " + symbol);

  if (owner.address.toLowerCase() === buyerAddr.toLowerCase()) {
    console.error("ERROR: Owner and buyer addresses are identical. Configure a separate buyer wallet.");
    process.exit(1);
  }

  const amountWei = ethers.BigNumber.from(FUND_AMOUNT_YODA)
    .mul(ethers.BigNumber.from(10).pow(decimals));

  if (ownerBal.lt(amountWei)) {
    console.error("ERROR: Owner has insufficient YODA");
    console.error("  required: " + amountWei.toString() + " base units");
    console.error("  have:     " + ownerBal.toString() + " base units");
    process.exit(1);
  }

  console.log("\nSending YODA...");
  const tx = await yoda.transfer(buyerAddr, amountWei);
  console.log("  tx:            " + tx.hash);
  console.log("  waiting for confirmation...");
  const receipt = await tx.wait();
  console.log("  ✓ confirmed in block " + receipt.blockNumber);
  console.log("  etherscan:     https://sepolia.etherscan.io/tx/" + receipt.transactionHash);

  const newBuyerBal = await yoda.balanceOf(buyerAddr);
  console.log("\nNew buyer balance: " + ethers.utils.formatUnits(newBuyerBal, decimals) + " " + symbol);
}

main().catch(err => {
  console.error("\nFATAL:", err.message || err);
  if (err.error && err.error.message) console.error("  reason:", err.error.message);
  process.exit(1);
});
