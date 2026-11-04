// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {DemoToken} from "../src/demo/DemoToken.sol";
import {DemoNFT} from "../src/demo/DemoNFT.sol";
import {VaultV2} from "../src/demo/VaultV2.sol";
import {VulnerableVault} from "../src/demo/VulnerableVault.sol";
import {VaultV3Unaudited} from "../src/demo/VaultV3Unaudited.sol";

/// @notice Deploys the demo dApp contracts and records `keccak256(eth_getCode)` for every deployed contract, so the
///         release manifest compares deployed code with deployed code.
///
///   forge script script/Deploy.s.sol --rpc-url sepolia --broadcast            (PRIVATE_KEY = OWNER_PRIVATE_KEY)
///   forge script script/Deploy.s.sol --rpc-url local --broadcast              (anvil)
contract Deploy is Script {
    bytes32 internal constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function run() external {
        uint256 key = vm.envUint("OWNER_PRIVATE_KEY");
        address owner = vm.addr(key);

        vm.startBroadcast(key);
        DemoToken token = new DemoToken();
        DemoNFT nft = new DemoNFT();
        address[] memory ops = new address[](1);
        ops[0] = owner;
        // upgrade timelock: owner key = proposer + executor, no admin (UPGRADE_DELAY seconds, default 120)
        TimelockController upgradeTimelock = new TimelockController(vm.envOr("UPGRADE_DELAY", uint256(120)), ops, ops, address(0));
        VaultV2 vaultImpl = new VaultV2();
        ERC1967Proxy vault = new ERC1967Proxy(address(vaultImpl), abi.encodeCall(VaultV2.initialize, (address(upgradeTimelock), IERC20(address(token)))));
        VulnerableVault legacyImpl = new VulnerableVault();
        ERC1967Proxy legacyVault =
            new ERC1967Proxy(address(legacyImpl), abi.encodeCall(VulnerableVault.initialize, (owner, IERC20(address(token)))));
        VaultV3Unaudited unauditedImpl = new VaultV3Unaudited();
        vm.stopBroadcast();

        address vaultImplOnChain = address(uint160(uint256(vm.load(address(vault), IMPLEMENTATION_SLOT))));
        require(vaultImplOnChain == address(vaultImpl), "vault proxy implementation mismatch");

        string memory root = "deployment";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeAddress(root, "owner", owner);
        vm.serializeUint(root, "blockNumber", block.number);
        vm.serializeString(root, "token", _entry("token", address(token), address(0)));
        vm.serializeString(root, "nft", _entry("nft", address(nft), address(0)));
        vm.serializeString(root, "vault", _entry("vault", address(vault), address(vaultImpl)));
        vm.serializeString(root, "legacyVault", _entry("legacyVault", address(legacyVault), address(legacyImpl)));
        string memory json = vm.serializeString(root, "unauditedImpl", _entry("unauditedImpl", address(unauditedImpl), address(0)));

        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console2.log("deployment written to", path);
        console2.log("VaultV2 proxy", address(vault));
        console2.log("VaultV2 implementation", address(vaultImpl));
    }

    function _entry(string memory label, address target, address impl) internal returns (string memory) {
        string memory o = string.concat("entry-", label);
        vm.serializeAddress(o, "address", target);
        vm.serializeBytes32(o, "runtimeCodehash", keccak256(target.code));
        if (impl == address(0)) return vm.serializeString(o, "proxy", "none");
        vm.serializeAddress(o, "implementation", impl);
        vm.serializeBytes32(o, "implementationCodehash", keccak256(impl.code));
        return vm.serializeString(o, "proxy", "eip1967");
    }
}
