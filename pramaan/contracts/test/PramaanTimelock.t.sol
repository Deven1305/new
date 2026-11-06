// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PramaanTimelock} from "../src/PramaanTimelock.sol";
import {ITextSetter} from "../src/interfaces/ITextSetter.sol";
import {MockPermissionedResolver} from "./mocks/MockPermissionedResolver.sol";

contract PramaanTimelockTest is Test {
    bytes internal constant NAME = hex"0c7072616d61616e2d64656d6f0365746800"; // "pramaan-demo.eth"
    string internal constant P1 =
        "pramaan:v1:v1.0.0:0b4c8f1e2d3a495867f6e5d4c3b2a1908f7e6d5c4b3a29180f1e2d3c4b5a6978";
    string internal constant P2 =
        "pramaan:v1:v1.1.0:1111111111111111111111111111111111111111111111111111111111111111";
    uint256 internal constant DELAY = 300;

    MockPermissionedResolver internal resolver;
    PramaanTimelock internal timelock;
    address internal proposer = makeAddr("proposer");
    address internal guardian = makeAddr("guardian");
    address internal stranger = makeAddr("stranger");

    event Queued(uint256 indexed id, string value, uint64 eta, address indexed proposer);
    event Executed(uint256 indexed id, string value, address indexed executor);
    event Cancelled(uint256 indexed id, address indexed guardian);
    event ProposerChanged(address indexed previousProposer, address indexed newProposer);

    function setUp() public {
        resolver = new MockPermissionedResolver();
        timelock = new PramaanTimelock(ITextSetter(address(resolver)), NAME, DELAY, proposer, guardian);
        resolver.grantTextKey("pramaan.record", address(timelock));
    }

    function _queue(string memory value) internal returns (uint256 id) {
        vm.prank(proposer);
        id = timelock.queue(value);
    }

    // --- configuration ---

    function test_constructor_storesConfig() public view {
        assertEq(address(timelock.resolver()), address(resolver));
        assertEq(timelock.dnsName(), NAME);
        assertEq(timelock.delay(), DELAY);
        assertEq(timelock.proposer(), proposer);
        assertEq(timelock.guardian(), guardian);
        assertEq(timelock.KEY(), "pramaan.record");
    }

    function test_constructor_rejectsBadConfig() public {
        vm.expectRevert(PramaanTimelock.InvalidConfig.selector);
        new PramaanTimelock(ITextSetter(address(0)), NAME, DELAY, proposer, guardian);
        vm.expectRevert(PramaanTimelock.InvalidConfig.selector);
        new PramaanTimelock(ITextSetter(address(resolver)), hex"0365746800", 10, proposer, guardian);
        vm.expectRevert(PramaanTimelock.InvalidConfig.selector);
        new PramaanTimelock(ITextSetter(address(resolver)), hex"036574", DELAY, proposer, guardian);
        vm.expectRevert(PramaanTimelock.InvalidConfig.selector);
        new PramaanTimelock(ITextSetter(address(resolver)), NAME, DELAY, address(0), guardian);
        vm.expectRevert(PramaanTimelock.InvalidConfig.selector);
        new PramaanTimelock(ITextSetter(address(resolver)), NAME, 31 days, proposer, guardian);
    }

    // --- queue ---

    function test_queue_onlyProposer() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PramaanTimelock.NotProposer.selector, stranger));
        timelock.queue(P1);
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(PramaanTimelock.NotProposer.selector, guardian));
        timelock.queue(P1);
    }

    function test_queue_emitsAndStores() public {
        uint64 eta = uint64(block.timestamp + DELAY);
        vm.expectEmit(true, true, false, true, address(timelock));
        emit Queued(1, P1, eta, proposer);
        uint256 id = _queue(P1);
        assertEq(id, 1);
        (string memory value, uint64 storedEta, PramaanTimelock.State state) = timelock.getOperation(id);
        assertEq(value, P1);
        assertEq(storedEta, eta);
        assertEq(uint8(state), uint8(PramaanTimelock.State.Queued));
        assertEq(resolver.setTextCalls(), 0, "queue must not touch ENS");
    }

    function test_queue_rejectsMalformedPointers() public {
        string[6] memory bad = [
            "",
            "pramaan:v1:",
            "ipfs://bafy",
            "pramaan:v2:v1:abc",
            "pramaan:v1:v1 0:abc",
            unicode"pramaan:v1:v1.0.0:é"
        ];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(proposer);
            vm.expectRevert(PramaanTimelock.InvalidValue.selector);
            timelock.queue(bad[i]);
        }
        vm.prank(proposer);
        vm.expectRevert(PramaanTimelock.InvalidValue.selector);
        timelock.queue(string(abi.encodePacked("pramaan:v1:", new bytes(300))));
    }

    // --- execute ---

    function test_execute_beforeEtaReverts() public {
        uint256 id = _queue(P1);
        vm.warp(block.timestamp + DELAY - 1);
        vm.expectRevert(abi.encodeWithSelector(PramaanTimelock.NotReady.selector, id, uint64(block.timestamp + 1)));
        timelock.execute(id);
    }

    function test_execute_byAnyoneAfterDelayWritesOnlyRecordKey() public {
        uint256 id = _queue(P1);
        vm.warp(block.timestamp + DELAY);
        vm.expectEmit(true, false, true, true, address(timelock));
        emit Executed(id, P1, stranger);
        vm.prank(stranger);
        timelock.execute(id);
        assertEq(resolver.text(NAME, "pramaan.record"), P1);
        assertEq(resolver.setTextCalls(), 1);
        assertEq(timelock.lastExecutedId(), id);
        vm.expectRevert(abi.encodeWithSelector(PramaanTimelock.NotQueued.selector, id));
        timelock.execute(id);
    }

    function test_execute_unknownIdReverts() public {
        vm.expectRevert(abi.encodeWithSelector(PramaanTimelock.NotQueued.selector, 42));
        timelock.execute(42);
    }

    function test_execute_expiredAfterGracePeriod() public {
        uint256 id = _queue(P1);
        vm.warp(block.timestamp + DELAY + timelock.GRACE_PERIOD() + 1);
        vm.expectRevert(abi.encodeWithSelector(PramaanTimelock.Expired.selector, id));
        timelock.execute(id);
    }

    function test_execute_cannotRollBackToOlderRelease() public {
        uint256 older = _queue(P1);
        uint256 newer = _queue(P2);
        vm.warp(block.timestamp + DELAY);
        timelock.execute(newer);
        assertFalse(timelock.isReady(older));
        vm.expectRevert(abi.encodeWithSelector(PramaanTimelock.Superseded.selector, older, newer));
        timelock.execute(older);
        assertEq(resolver.text(NAME, "pramaan.record"), P2);
    }

    function test_execute_twiceReverts() public {
        uint256 id = _queue(P1);
        vm.warp(block.timestamp + DELAY);
        timelock.execute(id);
        vm.expectRevert(abi.encodeWithSelector(PramaanTimelock.NotQueued.selector, id));
        timelock.execute(id);
    }

    function test_queue_rejectsReactivatingAnExecutedPointer() public {
        uint256 first = _queue(P1);
        vm.warp(block.timestamp + DELAY);
        timelock.execute(first);
        uint256 second = _queue(P2);
        vm.warp(block.timestamp + DELAY);
        timelock.execute(second);
        // A compromised proposer re-queues the old release under a fresh id: refused.
        vm.prank(proposer);
        vm.expectRevert(abi.encodeWithSelector(PramaanTimelock.AlreadyExecuted.selector, 3, first));
        timelock.queue(P1);
        assertEq(timelock.executedIdOf(keccak256(bytes(P1))), first);
        assertEq(resolver.text(NAME, "pramaan.record"), P2);
    }

    function test_execute_rejectsDuplicateQueuedValue() public {
        uint256 a = _queue(P1);
        uint256 b = _queue(P1); // same value queued twice before either ran
        vm.warp(block.timestamp + DELAY);
        timelock.execute(a);
        vm.expectRevert(abi.encodeWithSelector(PramaanTimelock.AlreadyExecuted.selector, b, a));
        timelock.execute(b);
    }

    function test_execute_cancelledThenRequeuedValueIsAllowed() public {
        uint256 a = _queue(P1);
        vm.prank(guardian);
        timelock.cancel(a);
        uint256 b = _queue(P1);
        vm.warp(block.timestamp + DELAY);
        timelock.execute(b);
        assertEq(resolver.text(NAME, "pramaan.record"), P1);
    }

    // --- cancel / guardian ---

    function test_cancel_onlyGuardianAndBlocksExecution() public {
        uint256 id = _queue(P1);
        vm.prank(proposer);
        vm.expectRevert(abi.encodeWithSelector(PramaanTimelock.NotGuardian.selector, proposer));
        timelock.cancel(id);

        vm.expectEmit(true, true, false, false, address(timelock));
        emit Cancelled(id, guardian);
        vm.prank(guardian);
        timelock.cancel(id);

        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(abi.encodeWithSelector(PramaanTimelock.NotQueued.selector, id));
        timelock.execute(id);
        assertEq(resolver.setTextCalls(), 0);
    }

    function test_setProposer_rotatesKey() public {
        address newProposer = makeAddr("newProposer");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PramaanTimelock.NotGuardian.selector, stranger));
        timelock.setProposer(newProposer);

        vm.expectEmit(true, true, false, false, address(timelock));
        emit ProposerChanged(proposer, newProposer);
        vm.prank(guardian);
        timelock.setProposer(newProposer);

        vm.prank(proposer);
        vm.expectRevert(abi.encodeWithSelector(PramaanTimelock.NotProposer.selector, proposer));
        timelock.queue(P1);
        vm.prank(newProposer);
        assertEq(timelock.queue(P1), 1);
    }

    // --- the key-scoped role is the security boundary ---

    function test_proposerCannotWriteEnsDirectly() public {
        uint256 resource = uint256(keccak256(bytes("pramaan.record")));
        vm.prank(proposer);
        vm.expectRevert(
            abi.encodeWithSelector(MockPermissionedResolver.EACUnauthorizedAccountRoles.selector, resource, 1 << 4, proposer)
        );
        resolver.setText(NAME, "pramaan.record", P1);
    }

    function test_timelockRoleDoesNotCoverOtherKeys() public {
        uint256 resource = uint256(keccak256(bytes("url")));
        vm.prank(address(timelock));
        vm.expectRevert(
            abi.encodeWithSelector(
                MockPermissionedResolver.EACUnauthorizedAccountRoles.selector, resource, 1 << 4, address(timelock)
            )
        );
        resolver.setText(NAME, "url", "https://evil.example");
    }

    function testFuzz_queueOnlyAcceptsPrefixedPrintablePointers(bytes calldata tail) public {
        string memory value = string(abi.encodePacked("pramaan:v1:", tail));
        bool printable = tail.length > 0 && tail.length + 11 <= 256;
        for (uint256 i; i < tail.length && printable; ++i) {
            if (tail[i] < 0x21 || tail[i] > 0x7e) printable = false;
        }
        vm.prank(proposer);
        if (!printable) vm.expectRevert(PramaanTimelock.InvalidValue.selector);
        timelock.queue(value);
    }
}
