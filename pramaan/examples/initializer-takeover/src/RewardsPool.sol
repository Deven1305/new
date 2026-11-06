// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice DELIBERATELY VULNERABLE example: `initialize()` has no guard, so anyone can call it again after
///         deployment, become the owner and use the owner-only emergency withdrawal. Used to exercise Pramaan's
///         initializer-takeover template. Never deploy with real funds.
contract RewardsPool {
    address public owner;
    uint256 public rewardRate;

    event Initialized(address indexed owner, uint256 rewardRate);
    event Funded(address indexed from, uint256 amount);

    function initialize(address owner_, uint256 rewardRate_) external {
        owner = owner_;
        rewardRate = rewardRate_;
        emit Initialized(owner_, rewardRate_);
    }

    function fund() external payable {
        emit Funded(msg.sender, msg.value);
    }

    function emergencyWithdraw() external {
        require(msg.sender == owner, "not owner");
        (bool ok,) = payable(owner).call{value: address(this).balance}("");
        require(ok, "transfer failed");
    }
}
