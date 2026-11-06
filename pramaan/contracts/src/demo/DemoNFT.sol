// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title DemoNFT (pNFT)
/// @notice Free test-network collectible used to demonstrate NFT transfers and `setApprovalForAll` warnings.
contract DemoNFT is ERC721 {
    uint256 public constant MAX_PER_ACCOUNT = 5;

    uint256 public totalMinted;
    mapping(address account => uint256) public mintedBy;

    error MintLimit();

    constructor() ERC721("Pramaan Demo Pass", "pNFT") {}

    function mint() external returns (uint256 tokenId) {
        if (mintedBy[msg.sender] >= MAX_PER_ACCOUNT) revert MintLimit();
        mintedBy[msg.sender] += 1;
        tokenId = ++totalMinted;
        _safeMint(msg.sender, tokenId);
    }
}
