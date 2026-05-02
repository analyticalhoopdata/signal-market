#!/usr/bin/env node
// ============================================================================
// deploy.js — Compile + deploy SignalMarket.sol to Sepolia
// ============================================================================
// Compiles SignalMarket.sol with solc-js, deploys it from PRIVATE_KEY in .env,
// and rewrites SIGNAL_MARKET_ADDRESS across all files that pin it.
// ============================================================================

require("dotenv").config();
const { ethers } = require("ethers");
const solc = require("solc");
const fs = require("fs");
const path = require("path");

const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const YODA_TOKEN_ADDRESS = "0xbd27d0b7F9fedb5A2A2C3ceF5dC9c70f3CF64Af2";
const ROOT = path.resolve(__dirname, "..");

function compileContract() {
  const sourcePath = path.join(ROOT, "SignalMarket.sol");
  const source = fs.readFileSync(sourcePath, "utf8");

  const input = {
    language: "Solidity",
    sources: { "SignalMarket.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } }
    }
  };

  console.log("Compiling SignalMarket.sol with solc " + solc.version() + " ...");
  const out = JSON.parse(solc.compile(JSON.stringify(input)));

  if (out.errors) {
    const fatal = out.errors.filter(e => e.severity === "error");
    if (fatal.length) {
      fatal.forEach(e => console.error(e.formattedMessage));
      throw new Error("Compilation failed");
    }
    out.errors.forEach(e => console.warn(e.formattedMessage));
  }

  const c = out.contracts["SignalMarket.sol"]["SignalMarket"];
  return { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };
}

function updateAddress(newAddr) {
  const targets = [
    {
      file: "frontend/index.html",
      pattern: /(const SIGNAL_MARKET_ADDRESS\s*=\s*")0x[a-fA-F0-9]{40}/g
    },
    {
      file: "scripts/listSignals.js",
      pattern: /(const SIGNAL_MARKET_ADDRESS\s*=\s*")0x[a-fA-F0-9]{40}/g
    },
    {
      file: "scripts/buySignal.js",
      pattern: /(const SIGNAL_MARKET_ADDRESS\s*=\s*")0x[a-fA-F0-9]{40}/g
    },
    {
      file: "scripts/fundBuyer.js",
      pattern: /(const SIGNAL_MARKET_ADDRESS\s*=\s*")0x[a-fA-F0-9]{40}/g
    },
    {
      file: "README.md",
      pattern: /(- Contract:\s*)0x[a-fA-F0-9]{40}/g
    },
    {
      file: "README.md",
      pattern: /(sepolia\.etherscan\.io\/address\/)0x[a-fA-F0-9]{40}/g
    }
  ];

  for (const t of targets) {
    const p = path.join(ROOT, t.file);
    if (!fs.existsSync(p)) {
      console.log("  skip (missing): " + t.file);
      continue;
    }
    const before = fs.readFileSync(p, "utf8");
    const after = before.replace(t.pattern, "$1" + newAddr);
    if (before === after) {
      console.log("  no match in:    " + t.file);
    } else {
      fs.writeFileSync(p, after);
      console.log("  updated:        " + t.file);
    }
  }
}

async function main() {
  console.log("============================================================");
  console.log("  SignalMarket — Deploy");
  console.log("============================================================");

  const pk = process.env.PRIVATE_KEY;
  if (!pk || pk === "your_private_key_here") {
    console.error("ERROR: PRIVATE_KEY not set in .env");
    process.exit(1);
  }

  const { abi, bytecode } = compileContract();
  console.log("  bytecode size: " + ((bytecode.length - 2) / 2) + " bytes\n");

  const provider = new ethers.providers.JsonRpcProvider(SEPOLIA_RPC);
  const wallet = new ethers.Wallet(pk, provider);
  const network = await provider.getNetwork();

  console.log("Deployer:     " + wallet.address);
  console.log("Network:      " + network.name + " (chainId " + network.chainId + ")");
  if (network.chainId !== 11155111) {
    console.error("ERROR: Not connected to Sepolia");
    process.exit(1);
  }

  const ethBal = await provider.getBalance(wallet.address);
  console.log("ETH balance:  " + ethers.utils.formatEther(ethBal) + " ETH");
  if (ethBal.isZero()) {
    console.error("ERROR: Deployer has 0 ETH on Sepolia — fund the wallet first.");
    process.exit(1);
  }

  console.log("\nDeploying SignalMarket(yodaToken=" + YODA_TOKEN_ADDRESS + ") ...");
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy(YODA_TOKEN_ADDRESS);
  console.log("  tx:           " + contract.deployTransaction.hash);
  console.log("  waiting for confirmation...");
  await contract.deployed();
  const receipt = await contract.deployTransaction.wait();

  const addr = contract.address;
  console.log("\n✓ Deployed to:  " + addr);
  console.log("  block:        " + receipt.blockNumber);
  console.log("  gas used:     " + receipt.gasUsed.toString());
  console.log("  etherscan:    https://sepolia.etherscan.io/address/" + addr);

  console.log("\nRewriting SIGNAL_MARKET_ADDRESS across files:");
  updateAddress(addr);

  // Save the ABI alongside the artifacts dir so other tools can read it
  const artifactsDir = path.join(ROOT, "artifacts");
  if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "SignalMarket.deploy.json"),
    JSON.stringify({ address: addr, deployedAt: new Date().toISOString(), abi }, null, 2)
  );
  console.log("\nWrote artifacts/SignalMarket.deploy.json");

  console.log("\n=== NEXT STEPS ===");
  console.log("  node scripts/listSignals.js");
  console.log("  node scripts/fundBuyer.js");
  console.log("  node scripts/buySignal.js 3");
  console.log("  node scripts/buySignal.js 4");
}

main().catch(err => {
  console.error("\nFATAL:", err.message || err);
  if (err.error && err.error.message) console.error("  reason:", err.error.message);
  process.exit(1);
});
