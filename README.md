# SignalMarket

A decentralized marketplace for limited-edition sports betting market-making signals, built as a class project for **UB CSE 426/526 — Blockchains, Cryptocurrencies, and Smart Contracts**.

Sellers (the contract owner) list signal "assets" — each one tagged with a sport, market type, a public preview hint, and a hidden description. Buyers purchase signals using the course **Yoda** ERC-20 token. Once purchased, the signal description unlocks for the buyer and the sale is recorded on-chain.

- **Network:** Ethereum Sepolia testnet
- **Smart contracts:** Solidity `^0.8.0`, deployed via Remix IDE
- **Frontend:** Single-file HTML/CSS/JS using ethers.js v5 via CDN
- **Payment token:** Yoda ERC-20 (provided by course staff)
- **No Hardhat. No React. No build tools.**

---

## Project structure

```
blockchain/
├── SignalMarket.sol        # Solidity contract (paste into Remix)
├── frontend/
│   └── index.html          # Single-file DApp — open in a browser
└── README.md               # This file
```

---

## Part 1 — Smart contract (`SignalMarket.sol`)

### Overview

`SignalMarket` is a zero-dependency marketplace contract. It defines the ERC-20 interface inline so the file can be copy-pasted directly into Remix without importing OpenZeppelin or any npm package.

### Storage

| Variable | Type | Purpose |
|---|---|---|
| `owner` | `address` | Deployer; the only account allowed to list signals |
| `yodaToken` | `address` | ERC-20 Yoda token used for payment |
| `signalCount` | `uint` | Auto-incrementing ID counter for listings |
| `signals` | `mapping(uint => Signal)` | Lookup from ID → signal struct |
| `ownedSignals` | `mapping(address => uint[])` | IDs of signals each buyer has purchased |

### Signal struct

```solidity
struct Signal {
    uint id;
    string sport;          // "NFL", "NBA", "Soccer", ...
    string market;         // "Moneyline", "Spread", "Over/Under", ...
    string description;    // revealed after purchase
    string previewHint;    // teaser shown before purchase
    uint priceInYoda;      // whole-number price (100 = 100 YODA)
    bool sold;
    address currentOwner;
}
```

### Events

```solidity
event SignalListed(uint indexed id, string sport, string market, uint priceInYoda);
event SignalPurchased(uint indexed id, address indexed buyer, uint priceInYoda);
```

### Functions

| Function | Who | What it does |
|---|---|---|
| `constructor(address _yodaToken)` | deployer | Sets `owner = msg.sender` and the Yoda token address |
| `listSignal(sport, market, description, previewHint, priceInYoda)` | owner | Creates a new listing; increments `signalCount`; emits `SignalListed` |
| `buySignal(signalId)` | any non-owner | Pulls `priceInYoda * 1e18` Yoda from buyer → owner via `transferFrom`; marks signal as sold; appends to buyer's owned list; emits `SignalPurchased` |
| `getSignal(signalId)` | anyone | Returns the signal. Masks `description` with `"Purchase to unlock"` for non-owners when the signal is unsold |
| `getMySignals()` | anyone | Returns the caller's `ownedSignals` array |
| `getAllSignals()` | anyone | Returns every signal from ID 1..`signalCount` with the same masking rule |

### Important details

- **18-decimal math.** `buySignal` multiplies `priceInYoda` by `1e18`, so if a signal is priced at `100`, the contract pulls `100 * 10^18` base units of Yoda.
- **Approval required.** Because `buySignal` calls `transferFrom`, the buyer must first call `yodaToken.approve(signalMarket, price * 1e18)`. The frontend handles this automatically.
- **Ownership rule.** The contract `owner` cannot buy their own listings (`require(msg.sender != owner)`).
- **Description masking is view-layer only.** The full description is always stored on-chain. Any node operator (or anyone calling the mapping directly through an explorer) could in theory read it. This marketplace is a *demonstration* of asset ownership, not a confidentiality system. In a real product you would encrypt descriptions off-chain and release keys on purchase.

---

## Part 2 — Frontend (`frontend/index.html`)

A single self-contained HTML file. No bundler, no install step. Open it locally in a browser with MetaMask installed and it runs.

### What's inside

- **ethers.js v5** loaded from `https://cdnjs.cloudflare.com/ajax/libs/ethers/5.7.2/ethers.umd.min.js`
- Two configuration constants at the top of the `<script>` block that you fill in after deployment:
  ```js
  const YODA_TOKEN_ADDRESS = "PLACEHOLDER_YODA";
  const SIGNAL_MARKET_ADDRESS = "PLACEHOLDER_MARKET";
  ```
- The full **SignalMarket ABI** as a JS array
- A **minimal ERC-20 ABI** (`balanceOf`, `decimals`, `symbol`, `allowance`, `approve`) — only the methods the UI actually needs
- Sepolia **chain enforcement**: if the user is on the wrong network, the DApp calls `wallet_switchEthereumChain` and falls back to `wallet_addEthereumChain` if Sepolia isn't installed

### UI sections

1. **Header** — brand mark, wallet connect button, Yoda balance pill
2. **Status banner** — live feedback for every async action (connecting, approving, buying, listing, errors)
3. **Owner-only "List a New Signal" form** — automatically shown only when the connected address matches `marketContract.owner()`
4. **Marketplace grid** — one card per signal from `getAllSignals()`. Locked descriptions render with a 🔒 placeholder; sold signals appear dimmed
5. **My Signals grid** — signals the connected wallet owns, with unlocked descriptions

### Buy flow

When the user clicks **Buy** on a signal card, the frontend:

1. Converts `priceInYoda` to base units (`price * 10^decimals`)
2. Verifies the buyer's Yoda balance is sufficient
3. Reads the current `allowance(buyer, signalMarket)` — if it's less than the price, sends an `approve` tx and waits for confirmation
4. Sends `buySignal(signalId)` and waits for confirmation
5. Refreshes the balance, marketplace, and "My Signals" views

### List flow (owner only)

1. Owner fills in sport, market, preview hint, description, price
2. Frontend calls `listSignal(sport, market, description, previewHint, priceInYoda)`
3. On confirmation, the form clears and the marketplace reloads

---

## Setup & deployment

### 1. Deploy the Yoda token

Use the Yoda ERC-20 contract provided by course staff. Deploy it to Sepolia (or reuse the shared class deployment) and note its address.

### 2. Deploy `SignalMarket.sol` via Remix

1. Go to <https://remix.ethereum.org>
2. Create a new file `SignalMarket.sol` and paste the contents of `SignalMarket.sol` from this repo
3. In the **Solidity Compiler** tab, pick compiler version `0.8.x` and click **Compile**
4. In the **Deploy & Run Transactions** tab:
   - Environment: **Injected Provider - MetaMask**
   - Make sure MetaMask is on **Sepolia**
   - Contract: `SignalMarket`
   - Constructor arg `_yodaToken`: the Yoda token address from step 1
   - Click **Deploy** and confirm in MetaMask
5. Copy the deployed contract address from Remix

### 3. Wire up the frontend

Open `frontend/index.html` and fill in:

```js
const YODA_TOKEN_ADDRESS = "0xYourYodaTokenAddress";
const SIGNAL_MARKET_ADDRESS = "0xYourSignalMarketAddress";
```

### 4. Run the frontend

Because the file is pure HTML/JS, you can either:

- **Just double-click `frontend/index.html`** to open it with the `file://` protocol, or
- Serve it with any static server, for example:
  ```bash
  cd frontend
  python3 -m http.server 8080
  # then open http://localhost:8080
  ```

Make sure MetaMask is installed, switched to Sepolia, and has an account with some Sepolia ETH (for gas) and Yoda tokens (for buying).

---

## Using the DApp

### As the owner (seller)

1. Click **Connect Wallet** — the DApp detects you are the contract owner and reveals the **List a New Signal** form.
2. Fill in the fields:
   - **Sport** — e.g. `NFL`
   - **Market** — e.g. `Moneyline`
   - **Preview Hint** — e.g. `NFL Week 12 - High edge opportunity`
   - **Description** — the actual pick (hidden until purchase), e.g. `Bills -3.5 vs Dolphins. Model edge 6.2%.`
   - **Price** — whole-number YODA amount, e.g. `100`
3. Click **List Signal**, confirm the transaction, and the card appears in the marketplace.

### As a buyer

1. Click **Connect Wallet**. The DApp will prompt you to switch to Sepolia if needed.
2. Make sure you have enough Yoda tokens (check the balance pill in the header).
3. Find a signal you like in the **Marketplace** grid — the description shows as `🔒 Purchase to unlock`.
4. Click **Buy**. The DApp will:
   - Send an `approve` transaction for the exact price (if allowance is insufficient)
   - Send a `buySignal` transaction
5. Once confirmed, the signal moves to your **My Signals** section with the description unlocked.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "MetaMask not detected" | No wallet extension | Install MetaMask |
| "Please switch to Sepolia" | Wrong network | Click connect again and approve the network switch |
| Balance shows `0` after connecting | No Yoda tokens on this address | Get Yoda from the course faucet / distribution |
| Buy fails with `transfer amount exceeds balance` | Not enough Yoda | Top up your Yoda balance |
| Buy fails with `transfer amount exceeds allowance` | Approval tx not confirmed yet | Wait for the approve tx, then click Buy again |
| `Not owner` when listing | Connected wallet isn't the deployer | Switch to the wallet that deployed `SignalMarket` |
| `Already sold` when buying | Someone beat you to it | Pick a different signal |
| Blank marketplace | `SIGNAL_MARKET_ADDRESS` still `PLACEHOLDER_MARKET` | Fill in the real contract address in `index.html` |
| ABI decode errors in console | Deployed contract doesn't match the source in this repo | Redeploy using the `SignalMarket.sol` in this repo |

---

## Notes & limitations

- **Descriptions are not private.** On-chain storage is public — the "locked" UI is a view-layer convenience only. Treat this project as a demo of token-gated ownership, not a confidentiality mechanism.
- **No cancel / re-list.** Once a signal is listed, there is no way to unlist it. Once it is sold, it cannot be resold.
- **No batching.** Each listing and each purchase is a separate transaction.
- **Owner centralisation.** Only the original deployer can list signals. Transferring ownership is not implemented.
- **Sepolia only.** The frontend hard-codes Sepolia's chain ID and will refuse to run on other networks.

These are acceptable simplifications for the CSE 426/526 assignment and keep the surface small enough to reason about end-to-end.

---

## Course info

- **Course:** CSE 426/526 — Blockchains, Cryptocurrencies, and Smart Contracts
- **Institution:** University at Buffalo
- **Toolchain:** Remix IDE, MetaMask, ethers.js v5, plain HTML/JS

## Performance Metrics
- Total transactions: 12
- Average transaction fee: 0.00259 ETH
- Transaction rate: 1.2 transactions/hour
- Total gas spent: 0.03111 ETH
- Contract: 0x5D6Ec77a95Cc0A7EA6047faE8140F9128E397f73
- Etherscan: https://sepolia.etherscan.io/address/0x5D6Ec77a95Cc0A7EA6047faE8140F9128E397f73
