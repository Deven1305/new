// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Fixed version of RewardsPool: initialize() runs only while no owner is set.
contract RewardsPoolFixed {
    address public owner;
    uint256 public rewardRate;

    event Initialized(address indexed owner, uint256 rewardRate);
    event Funded(address indexed from, uint256 amount);

    function initialize(address owner_, uint256 rewardRate_) external {
        require(owner == address(0), "already initialized");
        require(owner_ != address(0), "zero owner");
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
