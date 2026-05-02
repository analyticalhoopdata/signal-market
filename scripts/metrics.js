#!/usr/bin/env node
// ============================================================================
// metrics.js — Compute total tx count + gas usage on the deployed contract
// ============================================================================
// Pulls all SignalListed + SignalPurchased events from the contract's
// deploy block to chain head, dedupes tx hashes, adds the deploy tx, then
// fetches receipts to sum gas. Etherscan-free.
// ============================================================================

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const CONTRACT = "0x5D6Ec77a95Cc0A7EA6047faE8140F9128E397f73";

async function main() {
  const provider = new ethers.providers.JsonRpcProvider(SEPOLIA_RPC);

  // Pull deploy info we saved during deploy.js
  const deployJson = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "artifacts", "SignalMarket.deploy.json"),
      "utf8"
    )
  );

  // Find the deploy tx by searching the contract creation
  // The deploy tx hash isn't stored in our artifact; fetch the contract's
  // creation receipt by walking back from current state via getTransactionReceipt
  // on each known tx. Easier: scan transactions in the deploy block.
  const head = await provider.getBlockNumber();

  // Pull all logs from contract — both SignalListed and SignalPurchased
  console.log("Scanning logs from deploy era to head (" + head + ")...");
  const logs = await provider.getLogs({
    address: CONTRACT,
    fromBlock: 10773000,
    toBlock: head
  });
  console.log("  raw log count:", logs.length);

  const txHashes = new Set(logs.map(l => l.transactionHash));
  console.log("  unique tx hashes (interactions):", txHashes.size);

  // Deploy tx: scan the block at deploy time for the contract-creation tx
  // (one with `to == null` and resulting contract address == CONTRACT).
  const deployBlockNum = logs.length ? logs[0].blockNumber - 1 : 10773276;
  // Walk a few candidate blocks until we find the deploy tx
  let deployTxHash = null;
  for (let b = 10773276; b <= 10773277 && !deployTxHash; b++) {
    const block = await provider.getBlockWithTransactions(b);
    for (const tx of block.transactions) {
      if (tx.to == null && tx.creates && tx.creates.toLowerCase() === CONTRACT.toLowerCase()) {
        deployTxHash = tx.hash;
        break;
      }
      // Fallback: tx.creates may not be populated by all RPC nodes; check receipt
      if (tx.to == null) {
        const rcpt = await provider.getTransactionReceipt(tx.hash);
        if (rcpt && rcpt.contractAddress && rcpt.contractAddress.toLowerCase() === CONTRACT.toLowerCase()) {
          deployTxHash = tx.hash;
          break;
        }
      }
    }
  }
  if (deployTxHash) {
    txHashes.add(deployTxHash);
    console.log("  + deploy tx:", deployTxHash);
  } else {
    console.warn("  ⚠ deploy tx not located by block scan — metrics will exclude it");
  }

  // Fetch receipts for each unique tx, sum gas
  console.log("\nFetching receipts for " + txHashes.size + " transactions...");
  let totalGasWei = ethers.BigNumber.from(0);
  const perTx = [];

  for (const h of txHashes) {
    const r = await provider.getTransactionReceipt(h);
    const gasUsed = r.gasUsed;
    const effPrice = r.effectiveGasPrice || ethers.BigNumber.from(0);
    const cost = gasUsed.mul(effPrice);
    totalGasWei = totalGasWei.add(cost);
    perTx.push({
      hash: h,
      block: r.blockNumber,
      gasUsed: gasUsed.toString(),
      gasPrice: effPrice.toString(),
      feeWei: cost.toString(),
      feeEth: ethers.utils.formatEther(cost)
    });
  }

  perTx.sort((a, b) => a.block - b.block);

  const txCount = perTx.length;
  const totalEth = ethers.utils.formatEther(totalGasWei);
  const avgEth = txCount > 0
    ? ethers.utils.formatEther(totalGasWei.div(txCount))
    : "0";

  console.log("\n=========================================================");
  console.log("  Contract:        " + CONTRACT);
  console.log("  Total txs:       " + txCount);
  console.log("  Total gas spent: " + totalEth + " ETH");
  console.log("  Average tx fee:  " + avgEth + " ETH");
  console.log("=========================================================");

  // Save for downstream README update
  const out = {
    contract: CONTRACT,
    chain: "Sepolia",
    chainId: 11155111,
    computedAt: new Date().toISOString(),
    txCount,
    totalGasEth: totalEth,
    averageFeeEth: avgEth,
    deployTx: deployTxHash,
    transactions: perTx
  };
  const outPath = path.join(__dirname, "..", "artifacts", "SignalMarket.metrics.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("\nWrote " + outPath);
}

main().catch(err => {
  console.error("FATAL:", err.message || err);
  process.exit(1);
});
