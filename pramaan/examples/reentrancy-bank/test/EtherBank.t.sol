// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EtherBank} from "../src/EtherBank.sol";
import {EtherBankFixed} from "../src/EtherBankFixed.sol";

/// @notice The project's own regression tests: honest deposit/withdraw behaviour of both versions.
contract EtherBankTest is Test {
    address internal alice = makeAddr("alice");

    function setUp() public {
        vm.deal(alice, 5 ether);
    }

    function test_depositWithdraw() public {
        EtherBank bank = new EtherBank();
        vm.startPrank(alice);
        bank.deposit{value: 2 ether}();
        bank.withdraw();
        vm.stopPrank();
        assertEq(alice.balance, 5 ether);
        assertEq(bank.balances(alice), 0);
    }

    function test_fixedDepositWithdraw() public {
        EtherBankFixed bank = new EtherBankFixed();
        vm.startPrank(alice);
        bank.deposit{value: 2 ether}();
        bank.withdraw();
        vm.stopPrank();
        assertEq(alice.balance, 5 ether);
    }

    function test_withdrawWithoutDepositReverts() public {
        EtherBankFixed bank = new EtherBankFixed();
        vm.prank(alice);
        vm.expectRevert(bytes("nothing to withdraw"));
        bank.withdraw();
    }
}
