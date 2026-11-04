// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MirrorYieldFarm} from "../src/demo/MirrorYieldFarm.sol";
import {DemoToken} from "../src/demo/DemoToken.sol";

/// @dev A token that calls back into the farm in the middle of a transfer, to prove the farm's guard holds.
contract ReentrantToken is ERC20 {
    MirrorYieldFarm public farm;
    bytes4 public lastReentryError;
    bool public reentryAttempted;
    bytes public attack;

    constructor() ERC20("Evil", "EVIL") {
        _mint(msg.sender, 1_000_000e18);
    }

    function arm(MirrorYieldFarm farm_, bytes calldata attack_) external {
        farm = farm_;
        attack = attack_;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (attack.length > 0 && address(farm) != address(0) && (from == address(farm) || to == address(farm))) {
            bytes memory data = attack;
            attack = "";
            reentryAttempted = true;
            (bool ok, bytes memory ret) = address(farm).call(data);
            require(!ok, "reentrant call unexpectedly succeeded");
            lastReentryError = bytes4(ret);
        }
    }
}

contract MirrorYieldFarmTest is Test {
    uint256 internal constant REWARDS = 400_000e6;
    uint256 internal constant DURATION = 30 days;

    DemoToken internal pusd;
    MirrorYieldFarm internal farm;
    address internal owner;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    event Staked(address indexed account, uint256 amount);
    event Unstaked(address indexed account, uint256 amount);
    event RewardPaid(address indexed account, uint256 amount);
    event RewardsFunded(address indexed funder, uint256 amount, uint256 duration, uint256 rewardRate, uint256 periodFinish);

    function setUp() public {
        owner = address(this);
        pusd = new DemoToken();
        farm = new MirrorYieldFarm(IERC20(address(pusd)), IERC20(address(pusd)), owner);
        pusd.transfer(alice, 10_000e6);
        pusd.transfer(bob, 10_000e6);
        vm.prank(alice);
        pusd.approve(address(farm), type(uint256).max);
        vm.prank(bob);
        pusd.approve(address(farm), type(uint256).max);
    }

    function _fund() internal {
        pusd.approve(address(farm), REWARDS);
        farm.fundRewards(REWARDS, DURATION);
    }

    // -- construction ------------------------------------------------------------------------------------------------

    function test_constructor_storesConfig() public view {
        assertEq(address(farm.stakingToken()), address(pusd));
        assertEq(address(farm.rewardToken()), address(pusd));
        assertEq(farm.owner(), owner);
        assertEq(farm.totalStaked(), 0);
        assertEq(farm.rewardsRemaining(), 0);
    }

    function test_constructor_zeroAddressReverts() public {
        vm.expectRevert(MirrorYieldFarm.ZeroAddress.selector);
        new MirrorYieldFarm(IERC20(address(0)), IERC20(address(pusd)), owner);
        vm.expectRevert(MirrorYieldFarm.ZeroAddress.selector);
        new MirrorYieldFarm(IERC20(address(pusd)), IERC20(address(0)), owner);
    }

    // -- fundRewards -------------------------------------------------------------------------------------------------

    function test_fundRewards_setsRateAndEmits() public {
        pusd.approve(address(farm), REWARDS);
        uint256 rate = REWARDS / DURATION;
        vm.expectEmit(true, false, false, true);
        emit RewardsFunded(owner, REWARDS, DURATION, rate, block.timestamp + DURATION);
        farm.fundRewards(REWARDS, DURATION);
        assertEq(farm.rewardRate(), rate);
        assertEq(farm.periodFinish(), block.timestamp + DURATION);
        assertEq(farm.totalRewardsFunded(), REWARDS);
        assertEq(farm.rewardsRemaining(), DURATION * rate);
        assertEq(pusd.balanceOf(address(farm)), REWARDS);
    }

    function test_fundRewards_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        farm.fundRewards(1e6, 1 days);
    }

    function test_fundRewards_zeroAmountReverts() public {
        vm.expectRevert(MirrorYieldFarm.ZeroAmount.selector);
        farm.fundRewards(0, 1 days);
    }

    function test_fundRewards_invalidDurationReverts() public {
        pusd.approve(address(farm), REWARDS);
        vm.expectRevert(abi.encodeWithSelector(MirrorYieldFarm.InvalidDuration.selector, 0));
        farm.fundRewards(1e6, 0);
        uint256 tooLong = farm.MAX_REWARD_DURATION() + 1;
        vm.expectRevert(abi.encodeWithSelector(MirrorYieldFarm.InvalidDuration.selector, tooLong));
        farm.fundRewards(1e6, tooLong);
        farm.fundRewards(100e6, farm.MAX_REWARD_DURATION()); // the maximum itself is allowed
    }

    function test_fundRewards_rateTooLowReverts() public {
        pusd.approve(address(farm), REWARDS);
        vm.expectRevert(MirrorYieldFarm.RewardRateTooLow.selector);
        farm.fundRewards(100, 1 days);
    }

    function test_fundRewards_withoutAllowanceReverts() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(farm), 0, 1e6));
        farm.fundRewards(1e6, 1 days);
    }

    function test_fundRewards_topUpCarriesUnstreamedRewards() public {
        _fund();
        skip(DURATION / 2);
        uint256 remaining = farm.rewardsRemaining();
        pusd.approve(address(farm), 100_000e6);
        farm.fundRewards(100_000e6, 10 days);
        assertEq(farm.rewardRate(), (100_000e6 + remaining) / 10 days);
        assertEq(farm.periodFinish(), block.timestamp + 10 days);
        assertEq(farm.totalRewardsFunded(), REWARDS + 100_000e6);
    }

    // -- staking -----------------------------------------------------------------------------------------------------

    function test_stake_happyPath() public {
        vm.expectEmit(true, false, false, true);
        emit Staked(alice, 100e6);
        vm.prank(alice);
        farm.stake(100e6);
        assertEq(farm.stakedOf(alice), 100e6);
        assertEq(farm.totalStaked(), 100e6);
        assertEq(pusd.balanceOf(address(farm)), 100e6);
        assertEq(pusd.balanceOf(alice), 9_900e6);
    }

    function test_stake_zeroAmountReverts() public {
        vm.prank(alice);
        vm.expectRevert(MirrorYieldFarm.ZeroAmount.selector);
        farm.stake(0);
    }

    function test_stake_exactApprovalIsEnoughAndConsumed() public {
        address carol = makeAddr("carol");
        pusd.transfer(carol, 500e6);
        vm.startPrank(carol);
        pusd.approve(address(farm), 200e6);
        farm.stake(200e6);
        assertEq(pusd.allowance(carol, address(farm)), 0);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(farm), 0, 1));
        farm.stake(1);
        vm.stopPrank();
    }

    function test_stake_insufficientBalanceReverts() public {
        address carol = makeAddr("carol");
        vm.startPrank(carol);
        pusd.approve(address(farm), 100e6);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, carol, 0, 100e6));
        farm.stake(100e6);
        vm.stopPrank();
    }

    // -- unstaking ---------------------------------------------------------------------------------------------------

    function test_unstake_happyPath() public {
        vm.startPrank(alice);
        farm.stake(100e6);
        vm.expectEmit(true, false, false, true);
        emit Unstaked(alice, 40e6);
        farm.unstake(40e6);
        vm.stopPrank();
        assertEq(farm.stakedOf(alice), 60e6);
        assertEq(farm.totalStaked(), 60e6);
        assertEq(pusd.balanceOf(alice), 9_940e6);
    }

    function test_unstake_zeroAmountReverts() public {
        vm.startPrank(alice);
        farm.stake(10e6);
        vm.expectRevert(MirrorYieldFarm.ZeroAmount.selector);
        farm.unstake(0);
        vm.stopPrank();
    }

    function test_unstake_moreThanStakedReverts() public {
        vm.startPrank(alice);
        farm.stake(10e6);
        vm.expectRevert(abi.encodeWithSelector(MirrorYieldFarm.InsufficientStake.selector, 11e6, 10e6));
        farm.unstake(11e6);
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(MirrorYieldFarm.InsufficientStake.selector, 1, 0));
        farm.unstake(1);
    }

    // -- rewards -----------------------------------------------------------------------------------------------------

    function test_earned_streamsLinearlyToSoleStaker() public {
        _fund();
        vm.prank(alice);
        farm.stake(1_000e6);
        skip(1 days);
        uint256 rate = farm.rewardRate();
        assertEq(farm.earned(alice), 1 days * rate);
        skip(1 days);
        assertEq(farm.earned(alice), 2 days * rate);
    }

    function test_earned_sharedProRata() public {
        _fund();
        vm.prank(alice);
        farm.stake(3_000e6);
        vm.prank(bob);
        farm.stake(1_000e6);
        skip(10 days);
        uint256 total = 10 days * farm.rewardRate();
        assertApproxEqAbs(farm.earned(alice), (total * 3) / 4, 10);
        assertApproxEqAbs(farm.earned(bob), total / 4, 10);
        assertLe(farm.earned(alice) + farm.earned(bob), total);
    }

    function test_earned_stopsAtPeriodFinish() public {
        _fund();
        vm.prank(alice);
        farm.stake(1_000e6);
        skip(DURATION);
        uint256 atEnd = farm.earned(alice);
        skip(100 days);
        assertEq(farm.earned(alice), atEnd);
        assertEq(farm.rewardsRemaining(), 0);
        assertEq(farm.lastTimeRewardApplicable(), farm.periodFinish());
        assertApproxEqAbs(atEnd, REWARDS, DURATION); // rounding of rewardRate = REWARDS / DURATION
    }

    function test_noRewardsBeforeAnyoneStakes() public {
        _fund();
        skip(5 days);
        vm.prank(alice);
        farm.stake(1_000e6);
        assertEq(farm.earned(alice), 0, "rewards streamed while the pool was empty are not back-paid");
        skip(1 days);
        assertEq(farm.earned(alice), 1 days * farm.rewardRate());
    }

    function test_claim_happyPath() public {
        _fund();
        vm.prank(alice);
        farm.stake(1_000e6);
        skip(2 days);
        uint256 expected = farm.earned(alice);
        assertGt(expected, 0);
        uint256 before = pusd.balanceOf(alice);
        vm.expectEmit(true, false, false, true);
        emit RewardPaid(alice, expected);
        vm.prank(alice);
        farm.claim();
        assertEq(pusd.balanceOf(alice) - before, expected);
        assertEq(farm.earned(alice), 0);
        assertEq(farm.totalRewardsPaid(), expected);
        assertEq(farm.stakedOf(alice), 1_000e6, "claim leaves the stake alone");
    }

    function test_claim_nothingToClaimReverts() public {
        vm.prank(alice);
        vm.expectRevert(MirrorYieldFarm.NothingToClaim.selector);
        farm.claim();
        _fund();
        vm.prank(alice);
        farm.stake(1_000e6);
        vm.prank(alice);
        vm.expectRevert(MirrorYieldFarm.NothingToClaim.selector);
        farm.claim(); // same block as the stake
    }

    function test_exit_unstakesAndClaims() public {
        _fund();
        vm.prank(alice);
        farm.stake(1_000e6);
        skip(3 days);
        uint256 reward = farm.earned(alice);
        vm.prank(alice);
        farm.exit();
        assertEq(farm.stakedOf(alice), 0);
        assertEq(farm.totalStaked(), 0);
        assertEq(farm.earned(alice), 0);
        assertEq(pusd.balanceOf(alice), 10_000e6 + reward);
    }

    function test_exit_withoutRewardsStillReturnsStake() public {
        vm.startPrank(alice);
        farm.stake(500e6);
        farm.exit(); // no reward period at all: must not revert with NothingToClaim
        vm.stopPrank();
        assertEq(pusd.balanceOf(alice), 10_000e6);
    }

    function test_exit_withoutStakeReverts() public {
        vm.prank(alice);
        vm.expectRevert(MirrorYieldFarm.ZeroAmount.selector);
        farm.exit();
    }

    function test_donationsDoNotSkewAccounting() public {
        _fund();
        vm.prank(alice);
        farm.stake(1_000e6);
        pusd.transfer(address(farm), 50_000e6); // direct donation
        skip(1 days);
        assertEq(farm.earned(alice), 1 days * farm.rewardRate());
        assertEq(farm.totalStaked(), 1_000e6);
    }

    function test_rewardsRemainingMatchesViews() public {
        _fund();
        skip(10 days);
        assertEq(farm.rewardsRemaining(), (DURATION - 10 days) * farm.rewardRate());
    }

    // -- reentrancy --------------------------------------------------------------------------------------------------

    function _evilFarm() internal returns (ReentrantToken evil, MirrorYieldFarm f) {
        evil = new ReentrantToken();
        f = new MirrorYieldFarm(IERC20(address(evil)), IERC20(address(evil)), owner);
        evil.transfer(alice, 10_000e18);
        vm.prank(alice);
        evil.approve(address(f), type(uint256).max);
    }

    function test_reentrancy_stakeCannotReenter() public {
        (ReentrantToken evil, MirrorYieldFarm f) = _evilFarm();
        evil.arm(f, abi.encodeCall(MirrorYieldFarm.stake, (1)));
        vm.prank(alice);
        f.stake(100e18);
        assertTrue(evil.reentryAttempted());
        assertEq(evil.lastReentryError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(f.stakedOf(alice), 100e18);
        assertEq(f.totalStaked(), 100e18);
    }

    function test_reentrancy_unstakeCannotReenterClaimOrUnstake() public {
        (ReentrantToken evil, MirrorYieldFarm f) = _evilFarm();
        vm.prank(alice);
        f.stake(100e18);
        evil.arm(f, abi.encodeCall(MirrorYieldFarm.unstake, (50e18)));
        vm.prank(alice);
        f.unstake(40e18);
        assertTrue(evil.reentryAttempted());
        assertEq(evil.lastReentryError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(f.stakedOf(alice), 60e18, "exactly one unstake took effect");
        assertEq(f.totalStaked(), 60e18);
    }

    function test_reentrancy_exitCannotReenterExit() public {
        (ReentrantToken evil, MirrorYieldFarm f) = _evilFarm();
        vm.prank(alice);
        f.stake(100e18);
        evil.arm(f, abi.encodeCall(MirrorYieldFarm.exit, ()));
        vm.prank(alice);
        f.exit();
        assertEq(evil.lastReentryError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(f.totalStaked(), 0);
        assertEq(evil.balanceOf(alice), 10_000e18);
    }

    function test_reentrancy_fundRewardsCannotReenterStake() public {
        (ReentrantToken evil, MirrorYieldFarm f) = _evilFarm();
        evil.approve(address(f), type(uint256).max);
        evil.arm(f, abi.encodeCall(MirrorYieldFarm.stake, (1)));
        f.fundRewards(1_000e18, 1 days);
        assertEq(evil.lastReentryError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(f.totalStaked(), 0);
    }

    // -- fuzz --------------------------------------------------------------------------------------------------------

    function testFuzz_stakeUnstakeRoundTrip(uint256 stakeAmount, uint256 unstakeAmount) public {
        stakeAmount = bound(stakeAmount, 1, 10_000e6);
        unstakeAmount = bound(unstakeAmount, 1, stakeAmount);
        vm.startPrank(alice);
        farm.stake(stakeAmount);
        farm.unstake(unstakeAmount);
        vm.stopPrank();
        assertEq(farm.stakedOf(alice), stakeAmount - unstakeAmount);
        assertEq(farm.totalStaked(), stakeAmount - unstakeAmount);
        assertEq(pusd.balanceOf(address(farm)), stakeAmount - unstakeAmount);
        assertEq(pusd.balanceOf(alice), 10_000e6 - stakeAmount + unstakeAmount);
    }

    /// @dev Whatever the stakes and timing, stakers can never withdraw more reward than the owner funded.
    function testFuzz_rewardsNeverExceedFunded(uint96 aliceStake, uint96 bobStake, uint32 t1, uint32 t2, uint32 t3) public {
        aliceStake = uint96(bound(aliceStake, 1, 10_000e6));
        bobStake = uint96(bound(bobStake, 1, 10_000e6));
        _fund();
        vm.prank(alice);
        farm.stake(aliceStake);
        skip(bound(t1, 0, 20 days));
        vm.prank(bob);
        farm.stake(bobStake);
        skip(bound(t2, 0, 20 days));
        vm.prank(alice);
        farm.exit();
        skip(bound(t3, 0, 20 days));
        vm.prank(bob);
        farm.exit();
        assertLe(farm.totalRewardsPaid(), REWARDS);
        assertEq(farm.totalStaked(), 0);
        assertEq(pusd.balanceOf(alice) + pusd.balanceOf(bob), 20_000e6 + farm.totalRewardsPaid());
        assertGe(pusd.balanceOf(address(farm)), REWARDS - farm.totalRewardsPaid());
    }
}
