// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The one ENSv2 PermissionedResolver function the timelock is allowed to call.
/// @dev Matches `setText(bytes name, string key, string value)` on ENSv2's PermissionedResolver, where `name` is the
///      DNS-encoded ENS name.
interface ITextSetter {
    function setText(bytes calldata name, string calldata key, string calldata value) external;
}
