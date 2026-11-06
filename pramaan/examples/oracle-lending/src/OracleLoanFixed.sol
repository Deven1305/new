// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPriceFeed} from "./IPriceFeed.sol";

/// @notice The same pool with the feed answer validated: it must be positive and no older than `MAX_AGE`.
contract OracleLoanFixed {
    uint256 public constant REFERENCE_PRICE = 2000e8;
    uint256 public constant MAX_AGE = 1 hours;

    IPriceFeed public immutable feed;
    mapping(address account => uint256) public collateral;
    mapping(address account => uint256) public debt;

    event Deposited(address indexed account, uint256 amount);
    event Borrowed(address indexed account, uint256 amount);
    event Repaid(address indexed account, uint256 amount);

    constructor(IPriceFeed feed_) {
        feed = feed_;
    }

    function deposit() external payable {
        require(msg.value > 0, "zero deposit");
        collateral[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function borrow(uint256 amount) external {
        uint256 limit = (collateral[msg.sender] * _price()) / REFERENCE_PRICE;
        require(debt[msg.sender] + amount <= limit, "over the borrow limit");
        require(amount <= address(this).balance, "pool is short of ETH");
        debt[msg.sender] += amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        emit Borrowed(msg.sender, amount);
    }

    function repay() external payable {
        uint256 owed = debt[msg.sender];
        uint256 paid = msg.value > owed ? owed : msg.value;
        debt[msg.sender] = owed - paid;
        if (msg.value > paid) {
            (bool ok,) = msg.sender.call{value: msg.value - paid}("");
            require(ok, "refund failed");
        }
        emit Repaid(msg.sender, paid);
    }

    function _price() internal view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        require(answer > 0, "invalid oracle answer");
        require(block.timestamp - updatedAt <= MAX_AGE, "stale oracle answer");
        return uint256(answer);
    }
}
