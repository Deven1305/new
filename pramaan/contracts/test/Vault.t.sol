// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {VaultV2} from "../src/demo/VaultV2.sol";
import {VulnerableVault} from "../src/demo/VulnerableVault.sol";
import {VaultV3Unaudited} from "../src/demo/VaultV3Unaudited.sol";
import {DemoToken} from "../src/demo/DemoToken.sol";

/// @notice Regression suite for the vault. Pramaan re-runs this suite after applying a fix. The vault is owned by an
///         OpenZeppelin TimelockController (proposer + executor = the `owner` key, admin renounced), so every
///         privileged call (withdrawAll, upgrades) must be scheduled and executed after the delay.
contract VaultTest is Test {
    bytes32 internal constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    uint256 internal constant DELAY = 120;

    DemoToken internal token;
    VaultV2 internal vault;
    TimelockController internal timelock;
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        token = new DemoToken();
        address[] memory ops = new address[](1);
        ops[0] = owner;
        timelock = new TimelockController(DELAY, ops, ops, address(0));
        VaultV2 impl = new VaultV2();
        vault = VaultV2(
            payable(address(new ERC1967Proxy(address(impl), abi.encodeCall(VaultV2.initialize, (address(timelock), IERC20(address(token)))))))
        );
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.prank(alice);
        token.faucet();
    }

    // -- helpers -----------------------------------------------------------------------------------------------------

    function _schedule(address target, bytes memory data) internal returns (bytes32 salt) {
        salt = keccak256(abi.encode(target, data));
        vm.prank(owner);
        timelock.schedule(target, 0, data, bytes32(0), salt, DELAY);
    }

    function _execute(address target, bytes memory data, bytes32 salt) internal {
        vm.prank(owner);
        timelock.execute(target, 0, data, bytes32(0), salt);
    }

    function _notReady(bytes32 id) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(TimelockController.TimelockUnexpectedOperationState.selector, id, bytes32(uint256(1) << uint8(TimelockController.OperationState.Ready)));
    }

    // -- vault behaviour ---------------------------------------------------------------------------------------------

    function test_depositAndWithdrawEth() public {
        vm.prank(alice);
        vault.deposit{value: 3 ether}();
        assertEq(vault.ethBalanceOf(alice), 3 ether);
        vm.prank(alice);
        vault.withdraw(1 ether);
        assertEq(vault.ethBalanceOf(alice), 2 ether);
        assertEq(alice.balance, 98 ether);
        assertEq(vault.totalEthDeposits(), 2 ether);
    }

    function test_cannotWithdrawMoreThanDeposited() public {
        vm.prank(alice);
        vault.deposit{value: 1 ether}();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(VaultV2.InsufficientBalance.selector, 1 ether, 0));
        vault.withdraw(1 ether);
    }

    function test_zeroDepositReverts() public {
        vm.prank(alice);
        vm.expectRevert(VaultV2.ZeroAmount.selector);
        vault.deposit{value: 0}();
    }

    function test_tokenDepositAndWithdraw() public {
        vm.startPrank(alice);
        token.approve(address(vault), 400e6);
        vault.depositToken(400e6);
        vault.withdrawToken(150e6);
        vm.stopPrank();
        assertEq(vault.tokenBalanceOf(alice), 250e6);
        assertEq(token.balanceOf(alice), 750e6);
    }

    function test_withdrawAll_ownerOnly() public {
        vm.prank(alice);
        vault.deposit{value: 5 ether}();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, bob));
        vault.withdrawAll();
        // even the key that controls the timelock cannot call it directly: the owner is the timelock contract
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, owner));
        vault.withdrawAll();
        bytes memory data = abi.encodeCall(VaultV2.withdrawAll, ());
        bytes32 salt = _schedule(address(vault), data);
        skip(DELAY);
        _execute(address(vault), data, salt);
        assertEq(address(timelock).balance, 5 ether, "the sweep goes to the timelock (the vault's msg.sender)");
        assertEq(address(vault).balance, 0);
    }

    function test_initializeCannotRunTwice() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        vault.initialize(bob, IERC20(address(token)));
    }

    function test_implementationInitializersDisabled() public {
        VaultV2 impl = new VaultV2();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize(bob, IERC20(address(token)));
    }

    function test_versionStrings() public {
        assertEq(vault.version(), "2.0.0");
        assertEq(new VulnerableVault().version(), "1.0.0");
    }

    // -- upgrade timelock --------------------------------------------------------------------------------------------

    function test_ownerIsTimelockWithAdminRenounced() public view {
        assertEq(vault.owner(), address(timelock));
        assertEq(timelock.getMinDelay(), DELAY);
        assertFalse(timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), owner), "no human admin");
        assertFalse(timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), address(this)), "deployer holds no admin role");
        assertTrue(timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), address(timelock)), "only the timelock administers itself");
        assertTrue(timelock.hasRole(timelock.PROPOSER_ROLE(), owner));
        assertTrue(timelock.hasRole(timelock.EXECUTOR_ROLE(), owner));
        assertFalse(timelock.hasRole(timelock.PROPOSER_ROLE(), bob));
        assertFalse(timelock.hasRole(timelock.EXECUTOR_ROLE(), bob));
    }

    function test_upgrade_mustBeScheduledThenExecutedAfterDelay() public {
        VaultV3Unaudited next = new VaultV3Unaudited();
        bytes memory data = abi.encodeCall(vault.upgradeToAndCall, (address(next), ""));
        // a direct upgrade is impossible for everyone, including the timelock's proposer key
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, bob));
        vault.upgradeToAndCall(address(next), "");
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, owner));
        vault.upgradeToAndCall(address(next), "");

        bytes32 salt = _schedule(address(vault), data);
        bytes32 id = timelock.hashOperation(address(vault), 0, data, bytes32(0), salt);
        assertTrue(timelock.isOperationPending(id));

        vm.prank(owner);
        vm.expectRevert(_notReady(id));
        timelock.execute(address(vault), 0, data, bytes32(0), salt);
        skip(DELAY - 1);
        vm.prank(owner);
        vm.expectRevert(_notReady(id));
        timelock.execute(address(vault), 0, data, bytes32(0), salt);

        skip(1);
        assertTrue(timelock.isOperationReady(id));
        bytes32 executorRole = timelock.EXECUTOR_ROLE();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, executorRole));
        timelock.execute(address(vault), 0, data, bytes32(0), salt);

        _execute(address(vault), data, salt);
        assertTrue(timelock.isOperationDone(id));
        address impl = address(uint160(uint256(vm.load(address(vault), IMPLEMENTATION_SLOT))));
        assertEq(impl, address(next));
        assertEq(vault.version(), "3.0.0-unaudited");
    }

    function test_schedule_rejectsShortDelayAndStrangers() public {
        VaultV3Unaudited next = new VaultV3Unaudited();
        bytes memory data = abi.encodeCall(vault.upgradeToAndCall, (address(next), ""));
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(TimelockController.TimelockInsufficientDelay.selector, DELAY - 1, DELAY));
        timelock.schedule(address(vault), 0, data, bytes32(0), bytes32(0), DELAY - 1);
        bytes32 proposerRole = timelock.PROPOSER_ROLE();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, proposerRole));
        timelock.schedule(address(vault), 0, data, bytes32(0), bytes32(0), DELAY);
    }

    function test_cancelledUpgradeNeverRuns() public {
        VaultV3Unaudited next = new VaultV3Unaudited();
        bytes memory data = abi.encodeCall(vault.upgradeToAndCall, (address(next), ""));
        bytes32 salt = _schedule(address(vault), data);
        bytes32 id = timelock.hashOperation(address(vault), 0, data, bytes32(0), salt);
        vm.prank(owner);
        timelock.cancel(id);
        skip(DELAY);
        vm.prank(owner);
        vm.expectRevert(_notReady(id));
        timelock.execute(address(vault), 0, data, bytes32(0), salt);
        assertEq(vault.version(), "2.0.0");
    }

    function testFuzz_upgradeNeverReadyBeforeDelay(uint256 waited) public {
        waited = bound(waited, 0, DELAY - 1);
        VaultV3Unaudited next = new VaultV3Unaudited();
        bytes memory data = abi.encodeCall(vault.upgradeToAndCall, (address(next), ""));
        bytes32 salt = _schedule(address(vault), data);
        bytes32 id = timelock.hashOperation(address(vault), 0, data, bytes32(0), salt);
        skip(waited);
        vm.prank(owner);
        vm.expectRevert(_notReady(id));
        timelock.execute(address(vault), 0, data, bytes32(0), salt);
    }

    function testFuzz_depositWithdrawConservesBalance(uint96 depositAmount, uint96 withdrawAmount) public {
        uint256 d = bound(depositAmount, 1, 50 ether);
        uint256 w = bound(withdrawAmount, 1, d);
        vm.startPrank(alice);
        vault.deposit{value: d}();
        vault.withdraw(w);
        vm.stopPrank();
        assertEq(vault.ethBalanceOf(alice), d - w);
        assertEq(address(vault).balance, d - w);
        assertEq(alice.balance, 100 ether - d + w);
    }
}
