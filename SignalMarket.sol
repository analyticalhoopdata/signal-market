// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Minimal ERC-20 interface defined inline so this file has zero
// external dependencies and can be pasted directly into Remix.
interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

contract SignalMarket {
    struct Signal {
        uint id;
        string sport;
        string market;
        string description;
        string previewHint;
        uint priceInYoda;
        bool sold;
        address currentOwner;
    }

    address public owner;
    address public yodaToken;
    uint public signalCount;

    mapping(uint => Signal) public signals;
    mapping(address => uint[]) public ownedSignals;

    event SignalListed(uint indexed id, string sport, string market, uint priceInYoda);
    event SignalPurchased(uint indexed id, address indexed buyer, uint priceInYoda);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _yodaToken) {
        owner = msg.sender;
        yodaToken = _yodaToken;
    }

    function listSignal(
        string memory sport,
        string memory market,
        string memory description,
        string memory previewHint,
        uint priceInYoda
    ) external onlyOwner {
        signalCount++;
        signals[signalCount] = Signal({
            id: signalCount,
            sport: sport,
            market: market,
            description: description,
            previewHint: previewHint,
            priceInYoda: priceInYoda,
            sold: false,
            currentOwner: owner
        });
        emit SignalListed(signalCount, sport, market, priceInYoda);
    }

    function buySignal(uint signalId) external {
        require(signalId > 0 && signalId <= signalCount, "Signal does not exist");
        Signal storage s = signals[signalId];
        require(!s.sold, "Already sold");
        require(msg.sender != owner, "Owner cannot buy own signal");

        bool ok = IERC20(yodaToken).transferFrom(
            msg.sender,
            owner,
            s.priceInYoda * 1e18
        );
        require(ok, "Yoda transfer failed");

        s.sold = true;
        s.currentOwner = msg.sender;
        ownedSignals[msg.sender].push(signalId);

        emit SignalPurchased(signalId, msg.sender, s.priceInYoda);
    }

    function getSignal(uint signalId) external view returns (Signal memory) {
        require(signalId > 0 && signalId <= signalCount, "Signal does not exist");
        Signal memory s = signals[signalId];
        if (!s.sold && msg.sender != owner) {
            s.description = "Purchase to unlock";
        }
        return s;
    }

    function getMySignals() external view returns (uint[] memory) {
        return ownedSignals[msg.sender];
    }

    function getAllSignals() external view returns (Signal[] memory) {
        Signal[] memory all = new Signal[](signalCount);
        for (uint i = 1; i <= signalCount; i++) {
            Signal memory s = signals[i];
            if (!s.sold && msg.sender != owner) {
                s.description = "Purchase to unlock";
            }
            all[i - 1] = s;
        }
        return all;
    }
}
