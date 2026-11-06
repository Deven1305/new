// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice DELIBERATELY VULNERABLE example: `withdraw()` pays out before zeroing the caller's balance, so a contract
///         can re-enter it from its receive() hook and drain everyone's deposits. Used to exercise Pramaan's
///         reentrancy template. Never deploy with real funds.
contract EtherBank {
    mapping(address account => uint256) public balances;

    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);

    function deposit() external payable {
        require(msg.value > 0, "zero deposit");
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "nothing to withdraw");
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        balances[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
    }
}
