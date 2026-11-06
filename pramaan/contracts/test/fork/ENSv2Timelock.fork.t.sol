// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PramaanTimelock} from "../../src/PramaanTimelock.sol";
import {ITextSetter} from "../../src/interfaces/ITextSetter.sol";

struct Grant {
    address account;
    uint256 roleBitmap;
}

interface IVerifiableFactory {
    function deployProxy(address implementation, uint256 salt, bytes calldata data) external returns (address);
}

interface IPermissionedResolver {
    function initialize(Grant[] calldata grants, bytes[] calldata calls) external;
    function grantSetterRoles(bytes calldata setter, address account) external returns (bool);
    function revokeRoles(uint256 resource, uint256 roleBitmap, address account) external returns (bool);
    function setText(bytes calldata name, string calldata key, string calldata value) external;
    function setAddress(bytes calldata name, uint256 coinType, bytes calldata addressBytes) external;
    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory);
    function hasRoles(uint256 resource, uint256 roleBitmap, address account) external view returns (bool);
    function grantRoles(uint256 resource, uint256 roleBitmap, address account) external returns (bool);
}

interface IEAC {
    error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account);
    error EACCannotGrantRoles(uint256 resource, uint256 roleBitmap, address account);
}

/// @notice Runs the Pramaan authority split against the REAL ENSv2 PermissionedResolver deployed on Sepolia.
///         Skipped unless SEPOLIA_RPC_URL_A is set, e.g.
///         `SEPOLIA_RPC_URL_A=https://ethereum-sepolia-rpc.publicnode.com forge test --match-path test/fork/*`.
contract ENSv2TimelockForkTest is Test {
    // docs.ens.domains/learn/deployments (Sepolia), verified on Sourcify. Overridable for redeployments.
    address internal factory;
    address internal resolverImpl;

    uint256 internal constant ROLE_SET_ADDRESS = 1 << 0;
    uint256 internal constant ROLE_SET_TEXT = 1 << 4;
    uint256 internal constant ALL_ROLES = 0x1111111111111111111111111111111111111111111111111111111111111111;
    bytes4 internal constant TEXT_SELECTOR = bytes4(keccak256("text(bytes32,string)"));
    bytes internal constant NAME = hex"0c7072616d61616e2d64656d6f0365746800"; // pramaan-demo.eth
    string internal constant POINTER =
        "pramaan:v1:v1.0.0:9a8d7f2b3c4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8";

    address internal owner = makeAddr("ens-owner");
    address internal proposer = makeAddr("ci-proposer");
    IPermissionedResolver internal resolver;
    PramaanTimelock internal timelock;

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL_A", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        factory = vm.envOr("ENSV2_VERIFIABLE_FACTORY", address(0xDa70306C98E97eCe36F997a21368e53298572991));
        resolverImpl = vm.envOr("ENSV2_PERMISSIONED_RESOLVER_IMPL", address(0x115eb53F0c60696633855F90b138178Fb40b2b2C));
        assertGt(factory.code.length, 0, "VerifiableFactory has no code on this fork");
        assertGt(resolverImpl.code.length, 0, "PermissionedResolver implementation has no code on this fork");

        // The owner deploys a dedicated resolver and writes its owner-only records inside initialize().
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant({account: owner, roleBitmap: ALL_ROLES});
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(IPermissionedResolver.setText, (NAME, "pramaan.repo", "github.com/pramaan-dev/vault-app"));
        calls[1] = abi.encodeCall(IPermissionedResolver.setText, (NAME, "pramaan.domain", "https://vault.pramaan.example"));
        vm.prank(owner);
        resolver = IPermissionedResolver(
            IVerifiableFactory(factory).deployProxy(
                resolverImpl, uint256(keccak256("pramaan-fork-test")), abi.encodeCall(IPermissionedResolver.initialize, (grants, calls))
            )
        );

        timelock = new PramaanTimelock(ITextSetter(address(resolver)), NAME, 300, proposer, owner);

        // Key-scoped grant: ROLE_SET_TEXT on keccak256("pramaan.record") only.
        bytes memory setter = abi.encodeCall(IPermissionedResolver.setText, (bytes(""), "pramaan.record", ""));
        vm.prank(owner);
        resolver.grantSetterRoles(setter, address(timelock));
    }

    function _text(string memory key) internal view returns (string memory) {
        return abi.decode(resolver.resolve(NAME, abi.encodeWithSelector(TEXT_SELECTOR, bytes32(0), key)), (string));
    }

    function test_ownerRecordsWrittenDuringInitialize() public view {
        assertEq(_text("pramaan.repo"), "github.com/pramaan-dev/vault-app");
        assertEq(_text("pramaan.domain"), "https://vault.pramaan.example");
    }

    function test_timelockHoldsOnlyTheRecordKeyRole() public view {
        uint256 recordResource = uint256(keccak256(bytes("pramaan.record")));
        assertTrue(resolver.hasRoles(recordResource, ROLE_SET_TEXT, address(timelock)));
        assertFalse(resolver.hasRoles(uint256(keccak256(bytes("pramaan.domain"))), ROLE_SET_TEXT, address(timelock)));
        assertFalse(resolver.hasRoles(0, ROLE_SET_TEXT, address(timelock)), "no root text role");
    }

    function test_queueExecuteWritesPointerThroughRealResolver() public {
        vm.prank(proposer);
        uint256 id = timelock.queue(POINTER);
        assertEq(_text("pramaan.record"), "", "nothing changes before the delay");
        vm.warp(block.timestamp + 300);
        timelock.execute(id); // anyone
        assertEq(_text("pramaan.record"), POINTER);
    }

    function test_proposerKeyCannotWriteAnyRecordDirectly() public {
        vm.startPrank(proposer);
        vm.expectRevert(
            abi.encodeWithSelector(
                IEAC.EACUnauthorizedAccountRoles.selector, uint256(keccak256(bytes("pramaan.record"))), ROLE_SET_TEXT, proposer
            )
        );
        resolver.setText(NAME, "pramaan.record", POINTER);
        vm.expectRevert(
            abi.encodeWithSelector(IEAC.EACUnauthorizedAccountRoles.selector, uint256(keccak256(bytes("url"))), ROLE_SET_TEXT, proposer)
        );
        resolver.setText(NAME, "url", "https://evil.example");
        vm.expectRevert();
        resolver.setAddress(NAME, 60, abi.encodePacked(proposer));
        vm.stopPrank();
    }

    function test_keyScopedRoleCannotWriteOtherKeys() public {
        // Even the timelock's own address cannot use its role on another key.
        vm.prank(address(timelock));
        vm.expectRevert(
            abi.encodeWithSelector(
                IEAC.EACUnauthorizedAccountRoles.selector,
                uint256(keccak256(bytes("pramaan.domain"))),
                ROLE_SET_TEXT,
                address(timelock)
            )
        );
        resolver.setText(NAME, "pramaan.domain", "https://evil.example");
    }

    function test_genericGrantRolesAlwaysReverts() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IEAC.EACCannotGrantRoles.selector, 0, ROLE_SET_TEXT, proposer));
        resolver.grantRoles(0, ROLE_SET_TEXT, proposer);
    }

    function test_ownerCanRevokeTheTimelockRole() public {
        uint256 recordResource = uint256(keccak256(bytes("pramaan.record")));
        vm.prank(owner);
        resolver.revokeRoles(recordResource, ROLE_SET_TEXT, address(timelock));
        vm.prank(proposer);
        uint256 id = timelock.queue(POINTER);
        vm.warp(block.timestamp + 300);
        vm.expectRevert(
            abi.encodeWithSelector(IEAC.EACUnauthorizedAccountRoles.selector, recordResource, ROLE_SET_TEXT, address(timelock))
        );
        timelock.execute(id);
    }
}
