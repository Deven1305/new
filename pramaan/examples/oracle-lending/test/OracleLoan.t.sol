// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IPriceFeed} from "../src/IPriceFeed.sol";
import {OracleLoan} from "../src/OracleLoan.sol";
import {OracleLoanFixed} from "../src/OracleLoanFixed.sol";

contract TestFeed is IPriceFeed {
    int256 public answer;
    uint256 public updatedAt;

    constructor(int256 initial) {
        set(initial);
    }

    function set(int256 value) public {
        answer = value;
        updatedAt = block.timestamp;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestAnswer() external view returns (int256) {
        return answer;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

/// @notice The project's own regression tests: honest borrowing behaviour of both versions at a healthy price.
contract OracleLoanTest is Test {
    TestFeed internal feed;
    address internal alice = makeAddr("alice");

    function setUp() public {
        feed = new TestFeed(2000e8);
        vm.deal(alice, 10 ether);
    }

    function test_borrowWithinLimit() public {
        OracleLoan pool = new OracleLoan(feed);
        vm.deal(address(pool), 5 ether);
        vm.startPrank(alice);
        pool.deposit{value: 1 ether}();
        pool.borrow(0.5 ether);
        assertEq(pool.debt(alice), 0.5 ether);
        vm.expectRevert(bytes("over the borrow limit"));
        pool.borrow(0.6 ether);
        vm.stopPrank();
    }

    function test_fixedBorrowAndRepay() public {
        OracleLoanFixed pool = new OracleLoanFixed(feed);
        vm.deal(address(pool), 5 ether);
        vm.startPrank(alice);
        pool.deposit{value: 1 ether}();
        pool.borrow(1 ether);
        pool.repay{value: 1 ether}();
        vm.stopPrank();
        assertEq(pool.debt(alice), 0);
    }

    function test_fixedRejectsInvalidAndStaleAnswers() public {
        OracleLoanFixed pool = new OracleLoanFixed(feed);
        vm.deal(address(pool), 5 ether);
        vm.prank(alice);
        pool.deposit{value: 1}();
        feed.set(-1);
        vm.prank(alice);
        vm.expectRevert(bytes("invalid oracle answer"));
        pool.borrow(1 ether);
        feed.set(2000e8);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(alice);
        vm.expectRevert(bytes("stale oracle answer"));
        pool.borrow(1);
    }
}
