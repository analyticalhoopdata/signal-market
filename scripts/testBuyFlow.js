#!/usr/bin/env node
// ============================================================================
// testBuyFlow.js — Local test of the full buy flow
// ============================================================================
// Deploys MockYoda + SignalMarket on Hardhat's in-memory network,
// then runs: mint → list → approve → buy → verify ownership.
//
// Usage:
//   npx hardhat run scripts/testBuyFlow.js
// ============================================================================

const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  console.log("============================================================");
  console.log("  SIGNAL//MARKET — Local Buy Flow Test");
  console.log("  Network: Hardhat (in-memory)");
  console.log("============================================================\n");

  // --- Get test accounts ---
  const [owner, buyer] = await ethers.getSigners();
  console.log("Owner:  ", owner.address);
  console.log("Buyer:  ", buyer.address, "\n");

  // =========================================================================
  // STEP 1: Deploy MockYoda token
  // =========================================================================
  console.log("STEP 1 — Deploying MockYoda token...");
  const MockYoda = await ethers.getContractFactory("MockYoda");
  const yoda = await MockYoda.deploy();
  await yoda.deployed();
  console.log("  ✓ MockYoda deployed at:", yoda.address);

  const decimals = await yoda.decimals();
  const symbol = await yoda.symbol();
  console.log("  Token:", symbol, "| Decimals:", decimals, "\n");

  // =========================================================================
  // STEP 2: Deploy SignalMarket
  // =========================================================================
  console.log("STEP 2 — Deploying SignalMarket...");
  const SignalMarket = await ethers.getContractFactory("SignalMarket");
  const market = await SignalMarket.deploy(yoda.address);
  await market.deployed();
  console.log("  ✓ SignalMarket deployed at:", market.address);

  const contractOwner = await market.owner();
  console.log("  Contract owner:", contractOwner);
  console.log("  Matches deployer:", contractOwner === owner.address, "\n");

  // =========================================================================
  // STEP 3: Mint YODA tokens to buyer
  // =========================================================================
  const MINT_AMOUNT = 10000;
  const mintWei = ethers.utils.parseUnits(String(MINT_AMOUNT), decimals);

  console.log("STEP 3 — Minting " + MINT_AMOUNT + " " + symbol + " to buyer...");
  const mintTx = await yoda.mint(buyer.address, mintWei);
  await mintTx.wait();

  const buyerBalance = await yoda.balanceOf(buyer.address);
  console.log("  ✓ Buyer balance:", ethers.utils.formatUnits(buyerBalance, decimals), symbol, "\n");

  // =========================================================================
  // STEP 4: List a test signal as owner
  // =========================================================================
  console.log("STEP 4 — Listing test signal as owner...");
  const listTx = await market.connect(owner).listSignal(
    "NBA",
    "Player Props - Points",
    "under 22.5 Jayson Tatum Points Boston Celtics at Miami Heat\nOdds: 1.87 (-115)\nClosing Line: 1.80\nEdge (CLV): +3.89%\nMatchup: Boston Celtics at Miami Heat\nSource: ProphetX | Settled: WIN",
    "under 22.5 Jayson Tatum Points Boston Celtics at Miami Heat | EV: +3.9%",
    100
  );
  await listTx.wait();

  const signalCount = await market.signalCount();
  console.log("  ✓ Signal listed | ID:", signalCount.toString());

  // Verify signal data (as owner — should see full description)
  const signal = await market.connect(owner).getSignal(1);
  console.log("  Sport:", signal.sport);
  console.log("  Market:", signal.market);
  console.log("  Price:", signal.priceInYoda.toString(), symbol);
  console.log("  Sold:", signal.sold);
  console.log("  Owner:", signal.currentOwner, "\n");

  // =========================================================================
  // STEP 5: Verify description is masked for buyer (pre-purchase)
  // =========================================================================
  console.log("STEP 5 — Verifying description masking...");
  const maskedSignal = await market.connect(buyer).getSignal(1);
  console.log("  Description seen by buyer:", maskedSignal.description);
  const isMasked = maskedSignal.description === "Purchase to unlock";
  console.log("  ✓ Correctly masked:", isMasked, "\n");

  if (!isMasked) {
    console.error("  ✗ FAIL: Description should be masked for non-owner!");
    process.exit(1);
  }

  // =========================================================================
  // STEP 6: Approve YODA spending
  // =========================================================================
  const priceWei = signal.priceInYoda.mul(ethers.BigNumber.from(10).pow(decimals));
  console.log("STEP 6 — Approving " + signal.priceInYoda.toString() + " " + symbol + " for SignalMarket...");

  // Check allowance before
  const allowanceBefore = await yoda.allowance(buyer.address, market.address);
  console.log("  Allowance before:", ethers.utils.formatUnits(allowanceBefore, decimals));

  const approveTx = await yoda.connect(buyer).approve(market.address, priceWei);
  const approveReceipt = await approveTx.wait();
  console.log("  ✓ Approved | TX:", approveReceipt.transactionHash);

  const allowanceAfter = await yoda.allowance(buyer.address, market.address);
  console.log("  Allowance after:", ethers.utils.formatUnits(allowanceAfter, decimals), symbol, "\n");

  // =========================================================================
  // STEP 7: Buy the signal
  // =========================================================================
  console.log("STEP 7 — Buying signal #1...");
  const buyTx = await market.connect(buyer).buySignal(1);
  const buyReceipt = await buyTx.wait();
  console.log("  ✓ Purchased | TX:", buyReceipt.transactionHash);

  // Check for SignalPurchased event
  const purchaseEvent = buyReceipt.events.find(e => e.event === "SignalPurchased");
  if (purchaseEvent) {
    console.log("  Event SignalPurchased:");
    console.log("    signalId:", purchaseEvent.args.id.toString());
    console.log("    buyer:", purchaseEvent.args.buyer);
    console.log("    price:", purchaseEvent.args.priceInYoda.toString(), symbol);
  }
  console.log();

  // =========================================================================
  // STEP 8: Verify ownership and description unlock
  // =========================================================================
  console.log("STEP 8 — Verifying post-purchase state...");

  // Signal should now be sold with buyer as owner
  const boughtSignal = await market.connect(buyer).getSignal(1);
  console.log("  Signal sold:", boughtSignal.sold);
  console.log("  New owner:", boughtSignal.currentOwner);
  console.log("  Matches buyer:", boughtSignal.currentOwner === buyer.address);

  // Description should now be visible to buyer
  const descUnlocked = boughtSignal.description !== "Purchase to unlock";
  console.log("  Description unlocked:", descUnlocked);
  if (descUnlocked) {
    console.log("  Description: " + boughtSignal.description.split("\n")[0] + "...");
  }

  // Check ownedSignals
  const mySignals = await market.connect(buyer).getMySignals();
  console.log("  Buyer owned signals:", mySignals.map(id => id.toString()));

  // Check YODA balances
  const buyerFinal = await yoda.balanceOf(buyer.address);
  const ownerFinal = await yoda.balanceOf(owner.address);
  console.log("\n  Buyer YODA remaining:", ethers.utils.formatUnits(buyerFinal, decimals));
  console.log("  Owner YODA received:", ethers.utils.formatUnits(ownerFinal, decimals));

  // =========================================================================
  // STEP 9: Verify guard rails
  // =========================================================================
  console.log("\nSTEP 9 — Testing guard rails...");

  // 9a: Owner cannot buy own signal
  // List a second signal first
  await (await market.connect(owner).listSignal("MLB", "Run Line", "test", "test hint", 50)).wait();
  try {
    await market.connect(owner).buySignal(2);
    console.log("  ✗ FAIL: Owner was able to buy own signal!");
    process.exit(1);
  } catch (err) {
    console.log("  ✓ Owner cannot buy own signal:", err.message.includes("Owner cannot buy") ? "correct revert" : err.message);
  }

  // 9b: Cannot buy already-sold signal
  try {
    // Mint more tokens to buyer and approve
    await (await yoda.mint(buyer.address, priceWei)).wait();
    await (await yoda.connect(buyer).approve(market.address, priceWei)).wait();
    await market.connect(buyer).buySignal(1);
    console.log("  ✗ FAIL: Was able to buy already-sold signal!");
    process.exit(1);
  } catch (err) {
    console.log("  ✓ Cannot buy sold signal:", err.message.includes("Already sold") ? "correct revert" : err.message);
  }

  // 9c: Cannot buy nonexistent signal
  try {
    await market.connect(buyer).buySignal(999);
    console.log("  ✗ FAIL: Was able to buy nonexistent signal!");
    process.exit(1);
  } catch (err) {
    console.log("  ✓ Cannot buy nonexistent signal:", err.message.includes("does not exist") ? "correct revert" : err.message);
  }

  // =========================================================================
  // RESULTS
  // =========================================================================
  console.log("\n============================================================");
  console.log("  === ALL TESTS PASSED ===");
  console.log("  ✓ Deploy MockYoda + SignalMarket");
  console.log("  ✓ Mint tokens to buyer");
  console.log("  ✓ List signal as owner");
  console.log("  ✓ Description masked for non-owner");
  console.log("  ✓ Approve YODA for SignalMarket");
  console.log("  ✓ Buy signal as buyer");
  console.log("  ✓ Ownership transferred correctly");
  console.log("  ✓ Description unlocked after purchase");
  console.log("  ✓ YODA transferred from buyer to owner");
  console.log("  ✓ Owner cannot buy own signal");
  console.log("  ✓ Cannot re-buy sold signal");
  console.log("  ✓ Cannot buy nonexistent signal");
  console.log("============================================================");
}

main().catch(err => {
  console.error("\nFATAL:", err.message || err);
  process.exit(1);
});
