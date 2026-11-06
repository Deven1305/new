// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title VaultV2
/// @notice Demo vault that holds ETH and one ERC-20 token on behalf of its depositors. Deployed behind an ERC1967Proxy.
/// @dev Fixed version of VulnerableVault: `withdrawAll()` is restricted to the owner. Storage layout is unchanged.
contract VaultV2 is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    IERC20 public token;
    mapping(address account => uint256) public ethBalanceOf;
    mapping(address account => uint256) public tokenBalanceOf;
    uint256 public totalEthDeposits;
    uint256 public totalTokenDeposits;

    event Deposited(address indexed account, uint256 amount);
    event TokenDeposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event TokenWithdrawn(address indexed account, uint256 amount);
    event EmergencyWithdrawal(address indexed to, uint256 ethAmount, uint256 tokenAmount);

    error ZeroAmount();
    error InsufficientBalance(uint256 requested, uint256 available);
    error EthTransferFailed();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner, IERC20 token_) external initializer {
        __Ownable_init(initialOwner);
        token = token_;
    }

    function version() external pure virtual returns (string memory) {
        return "2.0.0";
    }

    function deposit() external payable {
        if (msg.value == 0) revert ZeroAmount();
        ethBalanceOf[msg.sender] += msg.value;
        totalEthDeposits += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function depositToken(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        tokenBalanceOf[msg.sender] += amount;
        totalTokenDeposits += amount;
        emit TokenDeposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        uint256 available = ethBalanceOf[msg.sender];
        if (amount == 0) revert ZeroAmount();
        if (amount > available) revert InsufficientBalance(amount, available);
        ethBalanceOf[msg.sender] = available - amount;
        totalEthDeposits -= amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert EthTransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    function withdrawToken(uint256 amount) external {
        uint256 available = tokenBalanceOf[msg.sender];
        if (amount == 0) revert ZeroAmount();
        if (amount > available) revert InsufficientBalance(amount, available);
        tokenBalanceOf[msg.sender] = available - amount;
        totalTokenDeposits -= amount;
        token.safeTransfer(msg.sender, amount);
        emit TokenWithdrawn(msg.sender, amount);
    }

    /// @notice Emergency sweep of every asset held by the vault. Owner only.
    function withdrawAll() external onlyOwner {
        uint256 ethAmount = address(this).balance;
        uint256 tokenAmount = token.balanceOf(address(this));
        totalEthDeposits = 0;
        totalTokenDeposits = 0;
        if (tokenAmount > 0) token.safeTransfer(msg.sender, tokenAmount);
        (bool ok,) = payable(msg.sender).call{value: ethAmount}("");
        if (!ok) revert EthTransferFailed();
        emit EmergencyWithdrawal(msg.sender, ethAmount, tokenAmount);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
