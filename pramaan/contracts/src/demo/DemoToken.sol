// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title DemoToken (pUSD)
/// @notice Test-network stablecoin stand-in with a rate-limited public faucet and EIP-2612 permit. No value.
/// @dev The deployer receives a one-time treasury supply (no further minting except the faucet), which the demo uses to
///      pre-fund the MirrorYield reward pool and seed liquidity.
contract DemoToken is ERC20, ERC20Permit {
    uint256 public constant FAUCET_AMOUNT = 1_000e6;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;
    uint256 public constant TREASURY_SUPPLY = 1_000_000e6;

    mapping(address account => uint256) public lastFaucetAt;

    error FaucetCooldown(uint256 availableAt);

    constructor() ERC20("Pramaan Demo USD", "pUSD") ERC20Permit("Pramaan Demo USD") {
        _mint(msg.sender, TREASURY_SUPPLY);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function faucet() external {
        uint256 last = lastFaucetAt[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) revert FaucetCooldown(last + FAUCET_COOLDOWN);
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
