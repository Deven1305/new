// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal stand-in for ENSv2's PermissionedResolver text records, faithful to its permission rule:
///         `setText` needs ROLE_SET_TEXT on `keccak256(key)` or on the root resource. Used only by unit tests; the
///         fork test runs the same scenario against the real resolver on Sepolia.
contract MockPermissionedResolver {
    uint256 public constant ROLE_SET_TEXT = 1 << 4;
    uint256 public constant ROOT_RESOURCE = 0;

    address public immutable owner;
    mapping(uint256 resource => mapping(address account => bool)) public canSetText;
    mapping(bytes32 nameHash => mapping(string key => string)) private _texts;
    uint256 public setTextCalls;

    event TextUpdated(bytes32 indexed nameHash, string key, string value);

    error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account);

    constructor() {
        owner = msg.sender;
        canSetText[ROOT_RESOURCE][msg.sender] = true;
    }

    function grantTextKey(string calldata key, address account) external {
        if (!canSetText[ROOT_RESOURCE][msg.sender]) {
            revert EACUnauthorizedAccountRoles(ROOT_RESOURCE, ROLE_SET_TEXT << 128, msg.sender);
        }
        canSetText[uint256(keccak256(bytes(key)))][account] = true;
    }

    function setText(bytes calldata name, string calldata key, string calldata value) external {
        uint256 resource = uint256(keccak256(bytes(key)));
        if (!canSetText[resource][msg.sender] && !canSetText[ROOT_RESOURCE][msg.sender]) {
            revert EACUnauthorizedAccountRoles(resource, ROLE_SET_TEXT, msg.sender);
        }
        _texts[keccak256(name)][key] = value;
        setTextCalls += 1;
        emit TextUpdated(keccak256(name), key, value);
    }

    function text(bytes calldata name, string calldata key) external view returns (string memory) {
        return _texts[keccak256(name)][key];
    }
}
