// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RewardsPool} from "../src/RewardsPool.sol";
import {RewardsPoolFixed} from "../src/RewardsPoolFixed.sol";

/// @notice The project's own regression tests for honest use of the pool.
contract RewardsPoolTest is Test {
    address internal owner = makeAddr("owner");

    function test_ownerCanWithdraw() public {
        RewardsPool pool = new RewardsPool();
        pool.initialize(owner, 5);
        vm.deal(address(this), 3 ether);
        pool.fund{value: 3 ether}();
        vm.prank(owner);
        pool.emergencyWithdraw();
        assertEq(owner.balance, 3 ether);
    }

    function test_fixedOwnerCanWithdraw() public {
        RewardsPoolFixed pool = new RewardsPoolFixed();
        pool.initialize(owner, 5);
        vm.deal(address(this), 3 ether);
        pool.fund{value: 3 ether}();
        vm.prank(owner);
        pool.emergencyWithdraw();
        assertEq(owner.balance, 3 ether);
        assertEq(pool.rewardRate(), 5);
    }
}
