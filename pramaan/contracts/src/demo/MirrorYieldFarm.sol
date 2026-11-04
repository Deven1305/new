// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MirrorYieldFarm
/// @notice Single-pool staking farm used by the MirrorYield demo (test networks only; the tokens have no value). Users
///         stake `stakingToken` and earn `rewardToken` from a pool the owner funds up front. Rewards stream at a fixed
///         `rewardRate` (reward units per second) until `periodFinish` and are shared pro rata between stakers
///         (the Synthetix StakingRewards model).
/// @dev Not upgradeable. The owner can only ADD rewards; no function moves staked principal except `unstake`/`exit` by
///      its owner. Accounting never reads the contract's own token balance, so donations cannot skew it. Every
///      state-changing function is nonReentrant, follows checks-effects-interactions and emits an event.
contract MirrorYieldFarm is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant PRECISION = 1e18;
    uint256 public constant MAX_REWARD_DURATION = 730 days;

    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardToken;

    /// @notice Reward-token units streamed per second while `block.timestamp < periodFinish`.
    uint256 public rewardRate;
    uint256 public periodFinish;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public totalStaked;
    uint256 public totalRewardsFunded;
    uint256 public totalRewardsPaid;

    mapping(address account => uint256) public stakedOf;
    mapping(address account => uint256) public userRewardPerTokenPaid;
    mapping(address account => uint256) public rewards;

    event Staked(address indexed account, uint256 amount);
    event Unstaked(address indexed account, uint256 amount);
    event RewardPaid(address indexed account, uint256 amount);
    event RewardsFunded(address indexed funder, uint256 amount, uint256 duration, uint256 rewardRate, uint256 periodFinish);

    error ZeroAddress();
    error ZeroAmount();
    error InsufficientStake(uint256 requested, uint256 available);
    error InvalidDuration(uint256 duration);
    error RewardRateTooLow();
    error NothingToClaim();

    constructor(IERC20 stakingToken_, IERC20 rewardToken_, address initialOwner) Ownable(initialOwner) {
        if (address(stakingToken_) == address(0) || address(rewardToken_) == address(0)) revert ZeroAddress();
        stakingToken = stakingToken_;
        rewardToken = rewardToken_;
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------------------------

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    /// @notice Accumulated reward per staked token, scaled by 1e18.
    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + ((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * PRECISION) / totalStaked;
    }

    /// @notice Rewards `account` can claim now.
    function earned(address account) public view returns (uint256) {
        return (stakedOf[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / PRECISION + rewards[account];
    }

    /// @notice Rewards still scheduled to stream after this block.
    function rewardsRemaining() public view returns (uint256) {
        return block.timestamp < periodFinish ? (periodFinish - block.timestamp) * rewardRate : 0;
    }

    // ---------------------------------------------------------------------------------------------------------------
    // User actions
    // ---------------------------------------------------------------------------------------------------------------

    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _updateReward(msg.sender);
        totalStaked += amount;
        stakedOf[msg.sender] += amount;
        emit Staked(msg.sender, amount);
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
    }

    function unstake(uint256 amount) external nonReentrant {
        _updateReward(msg.sender);
        _unstake(amount);
    }

    function claim() external nonReentrant {
        _updateReward(msg.sender);
        _claim();
    }

    /// @notice Unstakes everything and claims any rewards in one transaction.
    function exit() external nonReentrant {
        _updateReward(msg.sender);
        _unstake(stakedOf[msg.sender]);
        if (rewards[msg.sender] > 0) _claim();
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Owner
    // ---------------------------------------------------------------------------------------------------------------

    /// @notice Adds `amount` reward tokens (pulled from the owner) and streams them, together with any rewards not yet
    ///         streamed, evenly over the next `duration` seconds.
    function fundRewards(uint256 amount, uint256 duration) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (duration == 0 || duration > MAX_REWARD_DURATION) revert InvalidDuration(duration);
        _updateReward(address(0));
        uint256 newRate = (amount + rewardsRemaining()) / duration;
        if (newRate == 0) revert RewardRateTooLow();
        uint256 finish = block.timestamp + duration;
        rewardRate = newRate;
        lastUpdateTime = block.timestamp;
        periodFinish = finish;
        totalRewardsFunded += amount;
        emit RewardsFunded(msg.sender, amount, duration, newRate, finish);
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------------------------------------------

    function _updateReward(address account) private {
        uint256 perToken = rewardPerToken();
        rewardPerTokenStored = perToken;
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = perToken;
        }
    }

    function _unstake(uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        uint256 available = stakedOf[msg.sender];
        if (amount > available) revert InsufficientStake(amount, available);
        stakedOf[msg.sender] = available - amount;
        totalStaked -= amount;
        emit Unstaked(msg.sender, amount);
        stakingToken.safeTransfer(msg.sender, amount);
    }

    function _claim() private {
        uint256 reward = rewards[msg.sender];
        if (reward == 0) revert NothingToClaim();
        rewards[msg.sender] = 0;
        totalRewardsPaid += reward;
        emit RewardPaid(msg.sender, reward);
        rewardToken.safeTransfer(msg.sender, reward);
    }
}
